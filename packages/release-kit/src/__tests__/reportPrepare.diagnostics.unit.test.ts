import { measureWidth } from '@williamthorsen/nmr-core';
import { describe, expect, it } from 'vitest';

import { reportPrepare } from '../reportPrepare.ts';
import { makeReleasedWorkspace } from '../test-utils/reportPrepareFixtures.ts';
import type {
  PrepareResult,
  ReleasedCompositeResult,
  ReleasedPackageResult,
  SkippedCompositeResult,
  SkippedPackageResult,
} from '../types.ts';

/** The column budget to which `reportPrepare` cuts a commit subject. */
const SUBJECT_BUDGET_COLUMNS = 72;

describe(reportPrepare, () => {
  describe('policy violations rendering', () => {
    it('renders a single-package result with one policy violation', () => {
      const result: PrepareResult = {
        targets: [
          {
            targetId: '.',
            kind: 'package',
            status: 'released',
            previousTag: 'v1.0.0',
            commitCount: 1,
            parsedCommitCount: 1,
            releaseType: 'patch',
            currentVersion: '1.0.0',
            newVersion: '1.0.1',
            tag: 'v1.0.1',
            bumpedFiles: ['package.json'],
            changelogFiles: ['./CHANGELOG.md'],
            policyViolations: [
              {
                commitHash: 'def5678',
                commitSubject: 'internal!: refactor cache',
                type: 'internal',
                surface: 'prefix',
              },
            ],
          },
        ],
        tags: ['v1.0.1'],
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).toContain('1 policy violation:');
      expect(output).toContain("· def5678 'internal!: refactor cache': type 'internal' at prefix surface");
    });

    it('renders multiple policy violations with plural header', () => {
      const result: PrepareResult = {
        targets: [
          {
            targetId: '.',
            kind: 'package',
            status: 'released',
            commitCount: 2,
            parsedCommitCount: 2,
            releaseType: 'patch',
            currentVersion: '1.0.0',
            newVersion: '1.0.1',
            tag: 'v1.0.1',
            bumpedFiles: ['package.json'],
            changelogFiles: ['./CHANGELOG.md'],
            policyViolations: [
              {
                commitHash: 'aaa1111',
                commitSubject: 'internal!: refactor X',
                type: 'internal',
                surface: 'prefix',
              },
              {
                commitHash: 'bbb2222',
                commitSubject: 'drop: remove Y',
                type: 'drop',
                surface: 'prefix',
              },
            ],
          },
        ],
        tags: ['v1.0.1'],
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).toContain('2 policy violations:');
      expect(output).toContain("· aaa1111 'internal!: refactor X': type 'internal' at prefix surface");
      expect(output).toContain("· bbb2222 'drop: remove Y': type 'drop' at prefix surface");
    });

    it('renders a workspace section in multi-workspace mode with policy violations', () => {
      const result: PrepareResult = {
        targets: [
          {
            targetId: 'arrays',
            kind: 'package',
            name: 'arrays',
            status: 'released',
            commitCount: 1,
            parsedCommitCount: 1,
            releaseType: 'patch',
            currentVersion: '1.0.0',
            newVersion: '1.0.1',
            tag: 'arrays-v1.0.1',
            bumpedFiles: ['packages/arrays/package.json'],
            changelogFiles: ['packages/arrays/CHANGELOG.md'],
            policyViolations: [
              {
                commitHash: 'def5678',
                commitSubject: 'internal!: refactor cache',
                type: 'internal',
                surface: 'prefix',
              },
            ],
          },
        ],
        tags: ['arrays-v1.0.1'],
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).toContain('1 policy violation:');
      expect(output).toContain("· def5678 'internal!: refactor cache': type 'internal' at prefix surface");
    });

    it('renders a project section with policy violations', () => {
      const result: PrepareResult = {
        targets: [
          {
            targetId: '',
            kind: 'composite',
            status: 'released',
            previousTag: 'v1.0.0',
            commitCount: 1,
            parsedCommitCount: 1,
            releaseType: 'patch',
            currentVersion: '1.0.0',
            newVersion: '1.0.1',
            tag: 'v1.0.1',
            bumpedFiles: ['./package.json'],
            changelogFiles: ['./CHANGELOG.md'],
            commits: [{ message: 'internal!: refactor cache', subject: 'internal!: refactor cache', hash: 'def5678' }],
            policyViolations: [
              {
                commitHash: 'def5678',
                commitSubject: 'internal!: refactor cache',
                type: 'internal',
                surface: 'prefix',
              },
            ],
          },
        ],
        tags: ['v1.0.1'],
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).toContain('1 policy violation:');
      expect(output).toContain("· def5678 'internal!: refactor cache': type 'internal' at prefix surface");
    });

    it('omits the policy-violation block when policyViolations is undefined', () => {
      const result: PrepareResult = {
        targets: [
          {
            targetId: '.',
            kind: 'package',
            status: 'released',
            commitCount: 1,
            parsedCommitCount: 1,
            releaseType: 'minor',
            currentVersion: '1.0.0',
            newVersion: '1.1.0',
            tag: 'v1.1.0',
            bumpedFiles: ['package.json'],
            changelogFiles: ['./CHANGELOG.md'],
          },
        ],
        tags: ['v1.1.0'],
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).not.toContain('policy violation');
    });

    it('cuts a long commit subject to the column budget, marking the cut with an ellipsis', () => {
      const output = reportViolation(`internal!: ${'x'.repeat(80)}`);

      const subject = readViolationSubject(output);
      expect(measureWidth(subject)).toBeLessThanOrEqual(SUBJECT_BUDGET_COLUMNS);
      expect(subject.endsWith('…')).toBe(true);
    });

    it('cuts a subject of wide characters by column rather than by code unit', () => {
      // 71 code units, which the budget admits, and 141 columns, which it does not.
      const output = reportViolation(`x${'発'.repeat(70)}`);

      expect(measureWidth(readViolationSubject(output))).toBeLessThanOrEqual(SUBJECT_BUDGET_COLUMNS);
    });

    it('cuts a subject at a grapheme boundary rather than inside an emoji sequence', () => {
      // A cut by code unit would fall inside the ZWJ sequence; the column budget admits the sequence whole.
      const output = reportViolation(`${'x'.repeat(68)}👨‍👩‍👧‍👦 and more`);

      const subject = readViolationSubject(output);
      expect(subject).toContain('👨‍👩‍👧‍👦');
      expect(subject).not.toContain('\u{FFFD}');
      expect(Array.from(subject).some((character) => isSurrogate(character))).toBe(false);
    });

    it('renders a subject within the column budget whole', () => {
      const subject = 'internal!: refactor cache';

      const output = reportViolation(subject);

      expect(readViolationSubject(output)).toBe(subject);
    });
  });

  describe('change-record diagnostics rendering', () => {
    const SUBJECT = '#867 release-kit|feat: Read the change record (#42)';
    const diagnostics: Pick<ReleasedPackageResult, 'malformedBlocks' | 'policyViolations' | 'undeclaredEntryTypes'> = {
      malformedBlocks: [{ commitHash: 'abc1234def', commitSubject: SUBJECT, reason: '`entries[0].text` is missing' }],
      undeclaredEntryTypes: [{ commitHash: 'abc1234def', commitSubject: SUBJECT, entryPosition: 2, type: 'chore' }],
      policyViolations: [
        { commitHash: 'abc1234def', commitSubject: SUBJECT, type: 'drop', surface: 'entry', entryPosition: 3 },
      ],
    };
    const unparseableCommits = [{ message: 'Update readme', subject: 'Update readme', hash: 'fed4321cba' }];
    const expectedUnparseableLines = ['1 commit could not be parsed', '· fed4321 Update readme'];
    const expectedLines = [
      '1 change-record block could not be read (item taken from the title):',
      `· abc1234 '${SUBJECT}': \`entries[0].text\` is missing`,
      '1 change-record entry has an undeclared type (no item):',
      `· abc1234 '${SUBJECT}': type 'chore' at entry 2`,
      '1 policy violation:',
      `· abc1234 '${SUBJECT}': type 'drop' at entry 3`,
    ];

    it('renders each diagnostic kind in a single-package report', () => {
      const output = reportPrepare(
        { targets: [makeReleasedWorkspace(diagnostics)], tags: ['v1.0.1'] },
        { applied: false, style: 'rich' },
      );

      for (const line of expectedLines) {
        expect(output).toContain(line);
      }
    });

    it('renders each diagnostic kind in a monorepo workspace section', () => {
      const output = reportPrepare(
        { targets: [makeReleasedWorkspace({ name: 'arrays', ...diagnostics })], tags: ['arrays-v1.0.1'] },
        { applied: false, style: 'rich' },
      );

      for (const line of expectedLines) {
        expect(output).toContain(line);
      }
    });

    it('renders each diagnostic kind in a project section', () => {
      const project: ReleasedCompositeResult = {
        targetId: '',
        kind: 'composite',
        status: 'released',
        commitCount: 1,
        parsedCommitCount: 1,
        releaseType: 'patch',
        currentVersion: '1.0.0',
        newVersion: '1.0.1',
        tag: 'v1.0.1',
        bumpedFiles: ['./package.json'],
        changelogFiles: ['./CHANGELOG.md'],
        commits: [],
        ...diagnostics,
      };

      const output = reportPrepare({ targets: [project], tags: ['v1.0.1'] }, { applied: false, style: 'rich' });

      for (const line of expectedLines) {
        expect(output).toContain(line);
      }
    });

    it('renders each diagnostic kind and the unparseable commits in a skipped single-package report', () => {
      const output = reportPrepare(
        { targets: [makeSkippedWorkspace({ ...diagnostics, unparseableCommits })], tags: [] },
        { applied: false, style: 'rich' },
      );

      for (const line of [...expectedLines, ...expectedUnparseableLines]) {
        expect(output).toContain(line);
      }
    });

    it('renders each diagnostic kind and the unparseable commits in a skipped monorepo workspace section', () => {
      const output = reportPrepare(
        { targets: [makeSkippedWorkspace({ name: 'arrays', ...diagnostics, unparseableCommits })], tags: [] },
        { applied: false, style: 'rich' },
      );

      for (const line of [...expectedLines, ...expectedUnparseableLines]) {
        expect(output).toContain(line);
      }
    });

    it('renders each diagnostic kind and the unparseable commits in a skipped project section', () => {
      const project: SkippedCompositeResult = {
        targetId: '',
        kind: 'composite',
        status: 'skipped',
        commitCount: 2,
        parsedCommitCount: 0,
        skipReason: 'No bump-worthy commits since v1.0.0. Skipping.',
        unparseableCommits,
        ...diagnostics,
      };

      const output = reportPrepare({ targets: [project], tags: [] }, { applied: false, style: 'rich' });

      for (const line of [...expectedLines, ...expectedUnparseableLines]) {
        expect(output).toContain(line);
      }
    });

    it('pluralizes the headers', () => {
      const block = { commitHash: 'abc1234', commitSubject: SUBJECT, reason: 'bad' };
      const entry = { commitHash: 'abc1234', commitSubject: SUBJECT, entryPosition: 1, type: 'chore' };
      const output = reportPrepare(
        {
          targets: [makeReleasedWorkspace({ malformedBlocks: [block, block], undeclaredEntryTypes: [entry, entry] })],
          tags: ['v1.0.1'],
        },
        { applied: false, style: 'rich' },
      );

      expect(output).toContain('2 change-record blocks could not be read (item taken from the title):');
      expect(output).toContain('2 change-record entries have undeclared types (no item):');
    });

    it.each([
      ['released', makeReleasedWorkspace],
      ['skipped', makeSkippedWorkspace],
    ])('renders the unrouted entry scopes of a %s monorepo workspace', (_status, makeWorkspace) => {
      const unroutedEntryScopes = [
        { commitHash: 'abc1234def', commitSubject: SUBJECT, entryPosition: 2, scope: 'nmr' },
      ];

      const output = reportPrepare(
        { targets: [makeWorkspace({ name: 'arrays', unroutedEntryScopes })], tags: [] },
        { applied: false, style: 'rich' },
      );

      expect(output).toContain(
        "1 change-record entry scope does not match any workspace in the commit's window (no item there):",
      );
      expect(output).toContain(`· abc1234 '${SUBJECT}': scope 'nmr' at entry 2`);
    });

    it('pluralizes the unrouted entry scopes header', () => {
      const finding = { commitHash: 'abc1234', commitSubject: SUBJECT, entryPosition: 1, scope: 'nmr' };

      const output = reportPrepare(
        { targets: [makeReleasedWorkspace({ name: 'arrays', unroutedEntryScopes: [finding, finding] })], tags: [] },
        { applied: false, style: 'rich' },
      );

      expect(output).toContain(
        "2 change-record entry scopes do not match any workspace in the commit's window (no item there):",
      );
    });

    it('does not render any change-record lines when the result does not contain any', () => {
      const output = reportPrepare(
        { targets: [makeReleasedWorkspace()], tags: ['v1.0.1'] },
        { applied: false, style: 'rich' },
      );

      expect(output).not.toContain('change-record');
    });
  });
});

// region | Helpers
/** Reports whether a code point is a surrogate, which a cut inside a surrogate pair leaves behind. */
function isSurrogate(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint >= 0xd800 && codePoint <= 0xdfff;
}

/** Builds a skipped package result, with the given fields overriding a bump-less default. */
function makeSkippedWorkspace(overrides: Partial<SkippedPackageResult> = {}): SkippedPackageResult {
  return {
    targetId: overrides.name ?? '.',
    kind: 'package',
    status: 'skipped',
    previousTag: 'v1.0.0',
    commitCount: 2,
    parsedCommitCount: 0,
    skipReason: 'No bump-worthy commits since v1.0.0. Skipping.',
    ...overrides,
  };
}

/** Reads back the subject that the policy-violation bullet rendered, which the report quotes. */
function readViolationSubject(output: string): string {
  const match = /· \w+ '(.*)': type /.exec(output);
  if (match?.[1] === undefined) {
    throw new Error(`No policy-violation bullet in output:\n${output}`);
  }
  return match[1];
}

/** Renders a report whose one policy violation has `commitSubject`. */
function reportViolation(commitSubject: string): string {
  const result: PrepareResult = {
    targets: [
      makeReleasedWorkspace({
        policyViolations: [{ commitHash: 'def5678', commitSubject, type: 'internal', surface: 'prefix' }],
      }),
    ],
    tags: ['v1.0.1'],
  };
  return reportPrepare(result, { applied: true, style: 'rich' });
}
// endregion | Helpers
