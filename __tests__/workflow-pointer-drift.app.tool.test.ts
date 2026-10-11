import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import {
  checkWorkflowPointerDrift,
  formatDriftReport,
  isFailing,
  parseHolds,
  type PointerHold,
} from '../scripts/check-workflow-pointer-drift.ts';

const AUDIT_PATH = '.github/workflows/audit.reusable.yaml';
const AUDIT_TAG = 'workflow/audit-v1';
const SCRIPT_PATH = path.join(import.meta.dirname, '..', 'scripts', 'check-workflow-pointer-drift.ts');

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'pointer-drift-' })),
);

describe(checkWorkflowPointerDrift, () => {
  it('reports a tag at main’s newest commit touching its workflow as current', ({ tree }) => {
    initRepo(tree);
    tag(tree, AUDIT_TAG);
    commitFile(tree, 'README.md', 'unrelated');

    const report = check(tree);

    expect(report.statuses).toStrictEqual([{ kind: 'current', tag: AUDIT_TAG }]);
    expect(isFailing(report)).toBe(false);
  });

  it('reports a tag that never moved as drifted, naming each missing commit newest first', ({ tree }) => {
    initRepo(tree);
    tag(tree, AUDIT_TAG);
    commitFile(tree, AUDIT_PATH, 'second', 'Change audit once');
    commitFile(tree, AUDIT_PATH, 'third', 'Change audit twice');

    const report = check(tree);

    expect(report.statuses).toStrictEqual([
      {
        kind: 'drifted',
        tag: AUDIT_TAG,
        missingCommits: [expect.stringMatching(/ Change audit twice$/), expect.stringMatching(/ Change audit once$/)],
      },
    ]);
    expect(isFailing(report)).toBe(true);
  });

  it('reports a drifted tag as held when the hold covers every missing commit', ({ tree }) => {
    initRepo(tree);
    tag(tree, AUDIT_TAG);
    const through = commitFile(tree, AUDIT_PATH, 'second');
    const hold = { reason: 'consumers migrating', tag: AUDIT_TAG, through };

    const report = check(tree, [hold]);

    expect(report.statuses).toStrictEqual([{ kind: 'held', tag: AUDIT_TAG, hold }]);
    expect(isFailing(report)).toBe(false);
  });

  it('reports a held tag as drifted again once a later commit touches its workflow, naming only that commit', ({
    tree,
  }) => {
    initRepo(tree);
    tag(tree, AUDIT_TAG);
    const through = commitFile(tree, AUDIT_PATH, 'second');
    commitFile(tree, AUDIT_PATH, 'third', 'Change audit after the hold');

    const report = check(tree, [{ reason: 'consumers migrating', tag: AUDIT_TAG, through }]);

    expect(report.statuses).toStrictEqual([
      { kind: 'drifted', tag: AUDIT_TAG, missingCommits: [expect.stringMatching(/ Change audit after the hold$/)] },
    ]);
  });

  it('reports a tag whose workflow is absent from main as orphaned rather than failing', ({ tree }) => {
    initRepo(tree);
    tag(tree, 'workflow/never-written-v1');

    const report = check(tree);

    expect(report.statuses).toStrictEqual([
      {
        kind: 'orphaned',
        tag: 'workflow/never-written-v1',
        workflowPath: '.github/workflows/never-written.reusable.yaml',
      },
    ]);
    expect(isFailing(report)).toBe(false);
  });

  it('reports a tag outside the `workflow/{name}-v{major}` shape as unrecognized', ({ tree }) => {
    initRepo(tree);
    tag(tree, 'workflow/audit-latest');

    expect(check(tree).statuses).toStrictEqual([{ kind: 'unrecognized', tag: 'workflow/audit-latest' }]);
  });

  it('ignores tags outside the `workflow/` namespace', ({ tree }) => {
    initRepo(tree);
    tag(tree, 'audit-workflow-v1');

    expect(check(tree).statuses).toStrictEqual([]);
  });

  it('fails on a hold that names an unknown tag or a commit that does not resolve, and keeps the tag drifted', ({
    tree,
  }) => {
    initRepo(tree);
    tag(tree, AUDIT_TAG);
    commitFile(tree, AUDIT_PATH, 'second');

    const report = check(tree, [
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

  it('fails on a tag that is held more than once', ({ tree }) => {
    initRepo(tree);
    tag(tree, AUDIT_TAG);

    const report = check(tree, [
      { reason: 'first', tag: AUDIT_TAG, through: 'HEAD' },
      { reason: 'second', tag: AUDIT_TAG, through: 'HEAD' },
    ]);

    expect(report.holdErrors).toStrictEqual(['`workflow/audit-v1` is held more than once.']);
    expect(isFailing(report)).toBe(true);
  });
});

describe('the command', () => {
  it('fails on a holds file that is not valid JSON, and writes the report to stdout and the job summary', ({
    tree,
  }) => {
    initRepo(tree);
    tag(tree, AUDIT_TAG);
    tree.write('.config/workflow-pointer-holds.json', '[{ "tag": ');
    const summaryPath = path.join(tree.dir, 'summary.md');

    const result = spawnSync(process.execPath, [SCRIPT_PATH, 'main'], {
      cwd: tree.dir,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_STEP_SUMMARY: summaryPath },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('- The holds file is not valid JSON: SyntaxError');
    expect(readFileSync(summaryPath, 'utf8')).toBe(result.stdout);
  });

  it('exits zero when every tag is current', ({ tree }) => {
    initRepo(tree);
    tag(tree, AUDIT_TAG);

    const result = spawnSync(process.execPath, [SCRIPT_PATH, 'main'], {
      cwd: tree.dir,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_STEP_SUMMARY: '' },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('- ✅ `workflow/audit-v1` is current.');
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

/** Runs the check against the fixture's `main`. */
function check(tree: TempTree, holds: PointerHold[] = []) {
  return checkWorkflowPointerDrift({ holds, mainRef: 'main', repoDir: tree.dir });
}

/** Writes `content` to `filePath`, commits it, and returns the commit's SHA. */
function commitFile(tree: TempTree, filePath: string, content: string, message = `Write ${filePath}`): string {
  tree.write(filePath, `${content}\n`);
  git(tree, ['add', '--all']);
  git(tree, ['commit', '--message', message]);
  return git(tree, ['rev-parse', 'HEAD']);
}

/** Runs git in the fixture and returns its trimmed stdout. */
function git(tree: TempTree, args: string[]): string {
  return execFileSync('git', args, { cwd: tree.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Initializes a repository on `main` whose first commit writes the audit workflow. */
function initRepo(tree: TempTree): void {
  git(tree, ['init', '--initial-branch=main']);
  git(tree, ['config', 'user.email', 'fixture@example.com']);
  git(tree, ['config', 'user.name', 'Fixture']);
  git(tree, ['config', 'commit.gpgsign', 'false']);
  git(tree, ['config', 'tag.gpgsign', 'false']);
  commitFile(tree, AUDIT_PATH, 'first');
}

/** Creates an annotated tag at HEAD, the form in which the pointer tags are pushed. */
function tag(tree: TempTree, name: string): void {
  git(tree, ['tag', '--annotate', name, '--message', name]);
}

// endregion | Helpers
