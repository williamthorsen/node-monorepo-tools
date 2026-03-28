import { describe, expect, it } from 'vitest';

import { bold, dim, sectionHeader } from '../format.ts';
import { reportPrepare } from '../reportPrepare.ts';
import type { PrepareResult } from '../types.ts';

describe(reportPrepare, () => {
  describe('single-package mode', () => {
    it('formats a successful single-package release', () => {
      const result: PrepareResult = {
        components: [
          {
            status: 'released',
            previousTag: 'v1.0.0',
            commitCount: 3,
            parsedCommitCount: 2,
            releaseType: 'minor',
            currentVersion: '1.0.0',
            newVersion: '1.1.0',
            tag: 'v1.1.0',
            bumpedFiles: ['package.json'],
            changelogFiles: ['./CHANGELOG.md'],
          },
        ],
        tags: ['v1.1.0'],
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).toContain(dim('Found 3 commits since v1.0.0'));
      expect(output).toContain(dim('  Parsed 2 typed commits'));
      expect(output).toContain(dim('Bumping versions (minor)...'));
      expect(output).toContain(`📦 1.0.0 → ${bold('1.1.0')} (minor)`);
      expect(output).toContain(dim('  Bumped package.json'));
      expect(output).toContain(dim('Generating changelogs...'));
      expect(output).toContain(dim('  Generating changelog: ./CHANGELOG.md'));
      expect(output).toContain('✅ Release preparation complete.');
      expect(output).toContain(`   🏷️  ${bold('v1.1.0')}`);
    });

    it('renders "the beginning" when previousTag is undefined', () => {
      const result: PrepareResult = {
        components: [
          {
            status: 'released',
            previousTag: undefined,
            commitCount: 5,
            parsedCommitCount: 3,
            releaseType: 'minor',
            currentVersion: '0.0.0',
            newVersion: '0.1.0',
            tag: 'v0.1.0',
            bumpedFiles: ['package.json'],
            changelogFiles: ['./CHANGELOG.md'],
          },
        ],
        tags: ['v0.1.0'],
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).toContain(dim('Found 5 commits since the beginning'));
    });

    it('formats a skipped single-package release', () => {
      const result: PrepareResult = {
        components: [
          {
            status: 'skipped',
            previousTag: 'v1.0.0',
            commitCount: 1,
            parsedCommitCount: 0,
            bumpedFiles: [],
            changelogFiles: [],
            skipReason: 'No release-worthy changes found. Skipping.',
          },
        ],
        tags: [],
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).toContain(dim('Found 1 commits since v1.0.0'));
      expect(output).toContain('⏭️  No release-worthy changes found. Skipping.');
      expect(output).not.toContain('✅');
    });

    it('formats a dry-run single-package release', () => {
      const result: PrepareResult = {
        components: [
          {
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
          },
        ],
        tags: ['v1.0.1'],
        formatCommand: {
          command: 'npx prettier --write package.json ./CHANGELOG.md',
          executed: false,
          files: ['package.json', './CHANGELOG.md'],
        },
        dryRun: true,
      };

      const output = reportPrepare(result);

      expect(output).toContain(dim('  [dry-run] Would bump package.json'));
      expect(output).toContain(dim('  [dry-run] Would run: npx --yes git-cliff ... --output ./CHANGELOG.md'));
      expect(output).toContain(
        dim('\n  [dry-run] Would run format command: npx prettier --write package.json ./CHANGELOG.md'),
      );
    });

    it('formats a release with bump override', () => {
      const result: PrepareResult = {
        components: [
          {
            status: 'released',
            previousTag: 'v1.0.0',
            commitCount: 1,
            releaseType: 'major',
            currentVersion: '1.0.0',
            newVersion: '2.0.0',
            tag: 'v2.0.0',
            bumpedFiles: ['package.json'],
            changelogFiles: ['./CHANGELOG.md'],
          },
        ],
        tags: ['v2.0.0'],
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).toContain('Using bump override: major');
    });

    it('shows unparseable commit warning when all commits are unparseable (patch floor)', () => {
      const result: PrepareResult = {
        components: [
          {
            status: 'released',
            previousTag: 'v1.0.0',
            commitCount: 2,
            parsedCommitCount: 0,
            releaseType: 'patch',
            currentVersion: '1.0.0',
            newVersion: '1.0.1',
            tag: 'v1.0.1',
            bumpedFiles: ['package.json'],
            changelogFiles: ['./CHANGELOG.md'],
            unparseableCommits: [
              { message: 'chore: update deps', hash: 'abc1234' },
              { message: 'misc: tidy up', hash: 'def5678' },
            ],
          },
        ],
        tags: ['v1.0.1'],
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).toContain('⚠️  2 commits could not be parsed (defaulting to patch bump)');
      expect(output).toContain('· abc1234 chore: update deps');
      expect(output).toContain('· def5678 misc: tidy up');
    });

    it('shows unparseable commit warning without patch-floor note when some commits parsed', () => {
      const result: PrepareResult = {
        components: [
          {
            status: 'released',
            previousTag: 'v1.0.0',
            commitCount: 3,
            parsedCommitCount: 2,
            releaseType: 'minor',
            currentVersion: '1.0.0',
            newVersion: '1.1.0',
            tag: 'v1.1.0',
            bumpedFiles: ['package.json'],
            changelogFiles: ['./CHANGELOG.md'],
            unparseableCommits: [{ message: 'chore: update deps', hash: 'abc1234' }],
          },
        ],
        tags: ['v1.1.0'],
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).toContain('⚠️  1 commit could not be parsed');
      expect(output).not.toContain('defaulting to patch bump');
      expect(output).toContain('· abc1234 chore: update deps');
    });

    it('does not show unparseable warning when there are no unparseable commits', () => {
      const result: PrepareResult = {
        components: [
          {
            status: 'released',
            previousTag: 'v1.0.0',
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
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).not.toContain('⚠️');
      expect(output).not.toContain('could not be parsed');
    });
  });

  describe('empty components', () => {
    it('returns an empty string when components array is empty', () => {
      const result: PrepareResult = {
        components: [],
        tags: [],
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).toBe('');
    });
  });

  describe('monorepo mode', () => {
    it('formats a multi-component release', () => {
      const result: PrepareResult = {
        components: [
          {
            name: 'arrays',
            status: 'released',
            previousTag: 'arrays-v1.0.0',
            commitCount: 2,
            parsedCommitCount: 1,
            releaseType: 'minor',
            currentVersion: '1.0.0',
            newVersion: '1.1.0',
            tag: 'arrays-v1.1.0',
            bumpedFiles: ['packages/arrays/package.json'],
            changelogFiles: ['packages/arrays/CHANGELOG.md'],
          },
          {
            name: 'strings',
            status: 'released',
            previousTag: 'strings-v2.0.0',
            commitCount: 1,
            parsedCommitCount: 1,
            releaseType: 'patch',
            currentVersion: '2.0.0',
            newVersion: '2.0.1',
            tag: 'strings-v2.0.1',
            bumpedFiles: ['packages/strings/package.json'],
            changelogFiles: ['packages/strings/CHANGELOG.md'],
          },
        ],
        tags: ['arrays-v1.1.0', 'strings-v2.0.1'],
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).toContain(sectionHeader('arrays'));
      expect(output).toContain(sectionHeader('strings'));
      expect(output).toContain(`  🏷️  ${bold('arrays-v1.1.0')}`);
      expect(output).toContain(`  🏷️  ${bold('strings-v2.0.1')}`);
      expect(output).toContain('✅ Release preparation complete.');
      expect(output).toContain(`   🏷️  ${bold('arrays-v1.1.0')}`);
      expect(output).toContain(`   🏷️  ${bold('strings-v2.0.1')}`);
    });

    it('renders "(no previous release found)" when previousTag is undefined', () => {
      const result: PrepareResult = {
        components: [
          {
            name: 'arrays',
            status: 'released',
            previousTag: undefined,
            commitCount: 4,
            parsedCommitCount: 2,
            releaseType: 'minor',
            currentVersion: '0.0.0',
            newVersion: '0.1.0',
            tag: 'arrays-v0.1.0',
            bumpedFiles: ['packages/arrays/package.json'],
            changelogFiles: ['packages/arrays/CHANGELOG.md'],
          },
        ],
        tags: ['arrays-v0.1.0'],
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).toContain(dim('  Found 4 commits (no previous release found)'));
    });

    it('renders the changelog header with no file entries when changelogFiles is empty', () => {
      const result: PrepareResult = {
        components: [
          {
            name: 'arrays',
            status: 'released',
            previousTag: 'arrays-v1.0.0',
            commitCount: 2,
            parsedCommitCount: 1,
            releaseType: 'patch',
            currentVersion: '1.0.0',
            newVersion: '1.0.1',
            tag: 'arrays-v1.0.1',
            bumpedFiles: ['packages/arrays/package.json'],
            changelogFiles: [],
          },
        ],
        tags: ['arrays-v1.0.1'],
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).toContain(dim('  Generating changelogs...'));
      expect(output).not.toContain('Generating changelog:');
    });

    it('formats a partial skip in monorepo mode', () => {
      const result: PrepareResult = {
        components: [
          {
            name: 'arrays',
            status: 'released',
            previousTag: 'arrays-v1.0.0',
            commitCount: 1,
            parsedCommitCount: 1,
            releaseType: 'patch',
            currentVersion: '1.0.0',
            newVersion: '1.0.1',
            tag: 'arrays-v1.0.1',
            bumpedFiles: ['packages/arrays/package.json'],
            changelogFiles: ['packages/arrays/CHANGELOG.md'],
          },
          {
            name: 'strings',
            status: 'skipped',
            previousTag: 'strings-v2.0.0',
            commitCount: 0,
            bumpedFiles: [],
            changelogFiles: [],
            skipReason: 'No changes for strings since strings-v2.0.0. Skipping.',
          },
        ],
        tags: ['arrays-v1.0.1'],
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).toContain(sectionHeader('arrays'));
      expect(output).toContain(sectionHeader('strings'));
      expect(output).toContain('  ⏭️  No changes for strings since strings-v2.0.0. Skipping.');
      expect(output).toContain('✅ Release preparation complete.');
    });

    it('formats a full skip in monorepo mode', () => {
      const result: PrepareResult = {
        components: [
          {
            name: 'arrays',
            status: 'skipped',
            previousTag: 'arrays-v1.0.0',
            commitCount: 0,
            bumpedFiles: [],
            changelogFiles: [],
            skipReason: 'No changes for arrays since arrays-v1.0.0. Skipping.',
          },
        ],
        tags: [],
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).toContain('⏭️  No components had release-worthy changes.');
    });

    it('shows unparseable commit warning in monorepo mode', () => {
      const result: PrepareResult = {
        components: [
          {
            name: 'arrays',
            status: 'released',
            previousTag: 'arrays-v1.0.0',
            commitCount: 2,
            parsedCommitCount: 0,
            releaseType: 'patch',
            currentVersion: '1.0.0',
            newVersion: '1.0.1',
            tag: 'arrays-v1.0.1',
            bumpedFiles: ['packages/arrays/package.json'],
            changelogFiles: ['packages/arrays/CHANGELOG.md'],
            unparseableCommits: [{ message: 'chore: update deps', hash: 'abc1234' }],
          },
        ],
        tags: ['arrays-v1.0.1'],
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).toContain('⚠️  1 commit could not be parsed (defaulting to patch bump)');
      expect(output).toContain('· abc1234 chore: update deps');
    });

    it('formats format command in monorepo mode', () => {
      const result: PrepareResult = {
        components: [
          {
            name: 'arrays',
            status: 'released',
            previousTag: 'arrays-v1.0.0',
            commitCount: 1,
            parsedCommitCount: 1,
            releaseType: 'patch',
            currentVersion: '1.0.0',
            newVersion: '1.0.1',
            tag: 'arrays-v1.0.1',
            bumpedFiles: ['packages/arrays/package.json'],
            changelogFiles: ['packages/arrays/CHANGELOG.md'],
          },
        ],
        tags: ['arrays-v1.0.1'],
        formatCommand: {
          command: 'npx prettier --write packages/arrays/package.json packages/arrays/CHANGELOG.md',
          executed: true,
          files: ['packages/arrays/package.json', 'packages/arrays/CHANGELOG.md'],
        },
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).toContain(
        dim(
          '\n  Running format command: npx prettier --write packages/arrays/package.json packages/arrays/CHANGELOG.md',
        ),
      );
    });

    it('shows warnings when present in the result', () => {
      const result: PrepareResult = {
        components: [
          {
            name: 'core',
            status: 'released',
            previousTag: 'core-v1.0.0',
            commitCount: 1,
            parsedCommitCount: 1,
            releaseType: 'patch',
            currentVersion: '1.0.0',
            newVersion: '1.0.1',
            tag: 'core-v1.0.1',
            bumpedFiles: ['packages/core/package.json'],
            changelogFiles: ['packages/core/CHANGELOG.md'],
          },
        ],
        tags: ['core-v1.0.1'],
        dryRun: false,
        warnings: [
          'Circular workspace dependencies detected among: a, b. Propagation metadata may be incomplete for these components.',
        ],
      };

      const output = reportPrepare(result);

      expect(output).toContain('⚠️  Circular workspace dependencies detected among: a, b');
    });

    it('shows propagation info for a propagated-only component', () => {
      const result: PrepareResult = {
        components: [
          {
            name: 'core',
            status: 'released',
            previousTag: 'core-v1.0.0',
            commitCount: 1,
            parsedCommitCount: 1,
            releaseType: 'patch',
            currentVersion: '1.0.0',
            newVersion: '1.0.1',
            tag: 'core-v1.0.1',
            bumpedFiles: ['packages/core/package.json'],
            changelogFiles: ['packages/core/CHANGELOG.md'],
          },
          {
            name: 'app',
            status: 'released',
            previousTag: 'app-v2.0.0',
            commitCount: 0,
            releaseType: 'patch',
            currentVersion: '2.0.0',
            newVersion: '2.0.1',
            tag: 'app-v2.0.1',
            bumpedFiles: ['packages/app/package.json'],
            changelogFiles: ['packages/app/CHANGELOG.md'],
            propagatedFrom: [{ packageName: '@scope/core', newVersion: '1.0.1' }],
          },
        ],
        tags: ['core-v1.0.1', 'app-v2.0.1'],
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).toContain('0 commits (bumped via dependency: @scope/core)');
      expect(output).toContain('(patch, dependency: @scope/core)');
    });
  });
});
