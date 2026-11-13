import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import {
  checkWorkflowPointerDrift,
  formatDriftReport,
  isFailing,
  parseHolds,
  type PointerDriftGit,
  type PointerHold,
  readHolds,
} from '../scripts/check-workflow-pointer-drift.ts';

const AUDIT_TAG = 'workflow/audit-v1';
const THROUGH = 'abc1234';

const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'pointer-drift-holds-' })),
);

describe(checkWorkflowPointerDrift, () => {
  it('reports a tag that lacks no commit touching its workflow as current', () => {
    const report = check(createFakeGit({ listPointerTags: () => [AUDIT_TAG] }));

    expect(report.statuses).toStrictEqual([{ kind: 'current', tag: AUDIT_TAG }]);
    expect(isFailing(report)).toBe(false);
  });

  it('reports a tag that lacks commits as drifted, naming each missing commit in the order that git lists them', () => {
    const git = createFakeGit({
      listCommitsTouching: () => ['ccc Change audit twice', 'bbb Change audit once'],
      listPointerTags: () => [AUDIT_TAG],
    });

    const report = check(git);

    expect(report.statuses).toStrictEqual([
      { kind: 'drifted', tag: AUDIT_TAG, missingCommits: ['ccc Change audit twice', 'bbb Change audit once'] },
    ]);
    expect(isFailing(report)).toBe(true);
  });

  it('reports a drifted tag as held when the hold covers every missing commit', () => {
    const git = createFakeGit({
      listCommitsTouching: (revisions) => (revisions.includes(`^${THROUGH}`) ? [] : [`${THROUGH} Change audit`]),
      listPointerTags: () => [AUDIT_TAG],
    });
    const hold = { reason: 'consumers migrating', tag: AUDIT_TAG, through: THROUGH };

    const report = check(git, [hold]);

    expect(report.statuses).toStrictEqual([{ kind: 'held', tag: AUDIT_TAG, hold }]);
    expect(isFailing(report)).toBe(false);
  });

  it('reports a held tag as drifted once a later commit touches its workflow, naming only that commit', () => {
    const git = createFakeGit({
      listCommitsTouching: (revisions) =>
        revisions.includes(`^${THROUGH}`)
          ? ['ddd Change audit after the hold']
          : ['ddd Change audit after the hold', `${THROUGH} Change audit`],
      listPointerTags: () => [AUDIT_TAG],
    });

    const report = check(git, [{ reason: 'consumers migrating', tag: AUDIT_TAG, through: THROUGH }]);

    expect(report.statuses).toStrictEqual([
      { kind: 'drifted', tag: AUDIT_TAG, missingCommits: ['ddd Change audit after the hold'] },
    ]);
  });

  it('reports a tag whose workflow is absent from main as orphaned rather than failing', () => {
    const git = createFakeGit({
      isPresentAt: () => false,
      listPointerTags: () => ['workflow/never-written-v1'],
    });

    const report = check(git);

    expect(report.statuses).toStrictEqual([
      {
        kind: 'orphaned',
        tag: 'workflow/never-written-v1',
        workflowPath: '.github/workflows/never-written.reusable.yaml',
      },
    ]);
    expect(isFailing(report)).toBe(false);
  });

  it('reports a tag outside the `workflow/{name}-v{major}` shape as unrecognized', () => {
    const git = createFakeGit({ listPointerTags: () => ['workflow/audit-latest'] });

    expect(check(git).statuses).toStrictEqual([{ kind: 'unrecognized', tag: 'workflow/audit-latest' }]);
  });

  it('fails on a hold that names an unknown tag or a commit that does not resolve, and keeps the tag drifted', () => {
    const git = createFakeGit({
      listCommitsTouching: () => [`${THROUGH} Change audit`],
      listPointerTags: () => [AUDIT_TAG],
      resolvesToCommit: (revision) => revision !== 'deadbeef',
    });

    const report = check(git, [
      { reason: 'typo', tag: 'workflow/adit-v1', through: 'HEAD' },
      { reason: 'bad commit', tag: AUDIT_TAG, through: 'deadbeef' },
    ]);

    expect(report.holdErrors).toStrictEqual([
      '`workflow/adit-v1` is not a `workflow/*` tag.',
      "`workflow/audit-v1`'s `through` (`deadbeef`) does not name a commit.",
    ]);
    expect(report.statuses).toMatchObject([{ kind: 'drifted', tag: AUDIT_TAG }]);
    expect(isFailing(report)).toBe(true);
  });

  it('fails on a tag that is held more than once', () => {
    const report = check(createFakeGit({ listPointerTags: () => [AUDIT_TAG] }), [
      { reason: 'first', tag: AUDIT_TAG, through: 'HEAD' },
      { reason: 'second', tag: AUDIT_TAG, through: 'HEAD' },
    ]);

    expect(report.holdErrors).toStrictEqual(['`workflow/audit-v1` is held more than once.']);
    expect(isFailing(report)).toBe(true);
  });
});

describe(parseHolds, () => {
  it('accepts entries with non-empty `tag`, `through`, and `reason`, and reports the rest by index', () => {
    const valid = { reason: 'migrating', tag: AUDIT_TAG, through: 'abc123' };

    expect(parseHolds([valid, { tag: AUDIT_TAG, through: 'abc123' }, { ...valid, reason: ' ' }])).toStrictEqual({
      errors: [
        'Entry 1 must have non-empty string `tag`, `through`, and `reason` fields.',
        'Entry 2 must have non-empty string `tag`, `through`, and `reason` fields.',
      ],
      holds: [valid],
    });
  });

  it('rejects content that is not an array', () => {
    expect(parseHolds({ holds: [] })).toStrictEqual({
      errors: ['The holds file must contain a JSON array.'],
      holds: [],
    });
  });
});

describe(readHolds, () => {
  it('holds nothing when the file is missing', ({ tree }) => {
    expect(readHolds(path.join(tree.dir, 'holds.json'))).toStrictEqual({ errors: [], holds: [] });
  });

  it('reports a file that is not valid JSON', ({ tree }) => {
    tree.write('holds.json', '[{ "tag": ');

    expect(readHolds(path.join(tree.dir, 'holds.json'))).toStrictEqual({
      errors: [expect.stringMatching(/^The holds file is not valid JSON: SyntaxError/)],
      holds: [],
    });
  });

  it('parses the holds in a valid file', ({ tree }) => {
    const hold = { reason: 'migrating', tag: AUDIT_TAG, through: THROUGH };
    tree.write('holds.json', JSON.stringify([hold]));

    expect(readHolds(path.join(tree.dir, 'holds.json'))).toStrictEqual({ errors: [], holds: [hold] });
  });
});

describe(formatDriftReport, () => {
  it('lists each drifted tag’s missing commits beneath it and closes with the remedy', () => {
    const markdown = formatDriftReport({
      holdErrors: [],
      statuses: [{ kind: 'drifted', tag: AUDIT_TAG, missingCommits: ['abc123 Change audit'] }],
    });

    expect(markdown).toContain(
      '- ❌ `workflow/audit-v1` lacks 1 commit(s) that touch its workflow:\n  - abc123 Change audit\n',
    );
    expect(markdown).toContain('Move each drifted tag');
  });
});

// region | Helpers

/** Runs the check against `main` through `git`. */
function check(git: PointerDriftGit, holds: PointerHold[] = []) {
  return checkWorkflowPointerDrift({ git, holds, mainRef: 'main' });
}

/** Returns a fake adapter that lists no tags, finds every file, lists no commits, and resolves every revision. */
function createFakeGit(overrides: Partial<PointerDriftGit> = {}): PointerDriftGit {
  return {
    isPresentAt: () => true,
    listCommitsTouching: () => [],
    listPointerTags: () => [],
    resolvesToCommit: () => true,
    ...overrides,
  };
}

// endregion | Helpers
