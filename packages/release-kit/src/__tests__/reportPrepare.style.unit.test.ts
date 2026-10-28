import { describe, expect, it } from 'vitest';

import { bold } from '../format.ts';
import { reportPrepare } from '../reportPrepare.ts';
import { makeReleasedWorkspace } from '../test-utils/reportPrepareFixtures.ts';
import type { PolicyViolation, PrepareResult, ReleasedPackageResult } from '../types.ts';

describe(reportPrepare, () => {
  describe('plain style', () => {
    const unparseableCommits = [{ message: 'tidy things up', subject: 'tidy things up', hash: 'abc1234def' }];
    const policyViolations: PolicyViolation[] = [
      { commitHash: 'fed4321cba', commitSubject: 'feat!: drop the old API', type: 'feat', surface: 'prefix' },
    ];
    const formatCommand = { command: 'npx prettier --write package.json', files: ['package.json'] };
    const releasedWorkspace = makeReleasedWorkspace({ unparseableCommits, policyViolations });
    // A version override does not have a release type.
    const { releaseType: _releaseType, ...untypedWorkspace } = releasedWorkspace;
    const overriddenWorkspace: ReleasedPackageResult = { ...untypedWorkspace, versionOverride: '3.0.0' };

    // Together the fixtures populate every glyph-bearing branch of the formatter.
    const fixtures: Array<{ name: string; result: PrepareResult }> = [
      {
        name: 'a released single package',
        result: { targets: [releasedWorkspace], tags: ['v1.0.1'], formatCommand, warnings: ['README.md not found'] },
      },
      {
        name: 'a single package released by version override',
        result: { targets: [overriddenWorkspace], tags: ['v3.0.0'] },
      },
      {
        name: 'a skipped single package',
        result: {
          targets: [
            {
              targetId: '.',
              kind: 'package',
              status: 'skipped',
              commitCount: 1,
              parsedCommitCount: 0,
              unparseableCommits,
              policyViolations,
              skipReason: 'No changes.',
            },
          ],
          tags: [],
          warnings: ['README.md not found'],
        },
      },
      {
        name: 'a monorepo with released and skipped workspaces and a released project',
        result: {
          targets: [
            { ...releasedWorkspace, targetId: 'arrays', name: 'arrays', tag: 'arrays-v1.0.1' },
            { ...overriddenWorkspace, targetId: 'strings', name: 'strings', tag: 'strings-v3.0.0' },
            {
              targetId: 'numbers',
              kind: 'package',
              status: 'skipped',
              name: 'numbers',
              commitCount: 0,
              parsedCommitCount: 0,
              skipReason: 'No changes for numbers.',
            },
            {
              targetId: '',
              kind: 'composite',
              status: 'released',
              previousTag: 'v0.9.0',
              commitCount: 2,
              parsedCommitCount: 0,
              unparseableCommits,
              policyViolations,
              releaseType: 'patch',
              currentVersion: '0.9.0',
              newVersion: '0.9.1',
              tag: 'v0.9.1',
              bumpedFiles: ['./package.json'],
              changelogFiles: ['./CHANGELOG.md'],
              commits: [],
            },
          ],
          tags: ['arrays-v1.0.1', 'strings-v3.0.0', 'v0.9.1'],
          formatCommand,
          warnings: ['Circular workspace dependencies detected among: a, b'],
        },
      },
      {
        name: 'a monorepo in which nothing is released',
        result: {
          targets: [
            {
              targetId: 'numbers',
              kind: 'package',
              status: 'skipped',
              name: 'numbers',
              commitCount: 0,
              parsedCommitCount: 0,
              skipReason: 'No changes.',
            },
            {
              targetId: '',
              kind: 'composite',
              status: 'skipped',
              commitCount: 0,
              parsedCommitCount: 0,
              policyViolations,
              skipReason: 'No commits.',
            },
          ],
          tags: [],
        },
      },
    ];

    it.each(fixtures)('renders $name without a pictographic character', ({ result }) => {
      const options = { applied: true, formatError: 'Command failed with exit code 2' };

      // The rich render proves that the fixture exercises glyph-bearing branches.
      expect(reportPrepare(result, { ...options, style: 'rich' })).toMatch(/\p{Extended_Pictographic}/u);
      expect(reportPrepare(result, { ...options, style: 'plain' })).not.toMatch(/\p{Extended_Pictographic}/u);
    });

    it('replaces each glyph with its plain marker', () => {
      const result: PrepareResult = {
        targets: [releasedWorkspace],
        tags: ['v1.0.1'],
        formatCommand,
        warnings: ['README.md not found'],
      };

      const output = reportPrepare(result, { applied: true, formatError: 'exit code 2', style: 'plain' });

      expect(output).toContain('  WARN  1 commit could not be parsed');
      expect(output).toContain('  WARN  1 policy violation:');
      expect(output).toContain(`BUMP 1.0.0 → ${bold('1.0.1')} (patch)`);
      expect(output).toContain(
        '\n  WARN  Format command failed: npx prettier --write package.json\n        exit code 2',
      );
      expect(output).toContain('\nWARN  README.md not found');
      expect(output).toContain(`PASS  Release preparation complete.\n   TAG ${bold('v1.0.1')}`);
    });

    it('marks a skip with the plain skip marker', () => {
      const result: PrepareResult = {
        targets: [
          {
            targetId: '.',
            kind: 'package',
            status: 'skipped',
            commitCount: 0,
            parsedCommitCount: 0,
            skipReason: 'No changes. Skipping.',
          },
        ],
        tags: [],
      };

      const output = reportPrepare(result, { applied: true, style: 'plain' });

      expect(output).toContain('SKIP  No changes. Skipping.');
    });
  });
});
