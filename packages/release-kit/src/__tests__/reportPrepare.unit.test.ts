import { describe, expect, it } from 'vitest';

import { bold, dim, sectionHeader } from '../format.ts';
import { reportPrepare } from '../reportPrepare.ts';
import type { PrepareResult } from '../types.ts';

describe(reportPrepare, () => {
  describe('single-package mode', () => {
    it('formats a successful single-package release', () => {
      const result: PrepareResult = {
        workspaces: [
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
        workspaces: [
          {
            status: 'released',
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
        workspaces: [
          {
            status: 'skipped',
            previousTag: 'v1.0.0',
            commitCount: 1,
            parsedCommitCount: 0,
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
        workspaces: [
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
        workspaces: [
          {
            status: 'released',
            previousTag: 'v1.0.0',
            commitCount: 1,
            parsedCommitCount: 0,
            releaseType: 'major',
            bumpOverride: 'major',
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

    it('renders "version override" labels when setVersion is present on a workspace', () => {
      const result: PrepareResult = {
        workspaces: [
          {
            status: 'released',
            previousTag: 'v0.5.0',
            commitCount: 0,
            currentVersion: '0.5.0',
            newVersion: '1.0.0',
            tag: 'v1.0.0',
            bumpedFiles: ['package.json'],
            changelogFiles: ['./CHANGELOG.md'],
            setVersion: '1.0.0',
          },
        ],
        tags: ['v1.0.0'],
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).toContain('Using version override: 1.0.0');
      expect(output).toContain(`📦 0.5.0 → ${bold('1.0.0')} (version override)`);
      expect(output).not.toContain('Using bump override:');
    });

    it('shows unparseable commit warning when all commits are unparseable (patch floor)', () => {
      const result: PrepareResult = {
        workspaces: [
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
        workspaces: [
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
        workspaces: [
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

  describe('empty workspaces', () => {
    it('returns an empty string when workspaces array is empty', () => {
      const result: PrepareResult = {
        workspaces: [],
        tags: [],
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).toBe('');
    });
  });

  describe('monorepo mode', () => {
    it('formats a multi-workspace release', () => {
      const result: PrepareResult = {
        workspaces: [
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
        workspaces: [
          {
            name: 'arrays',
            status: 'released',
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
        workspaces: [
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
        workspaces: [
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

    it('renders "version override" labels for a setVersion workspace in monorepo mode', () => {
      const result: PrepareResult = {
        workspaces: [
          {
            name: 'arrays',
            status: 'released',
            previousTag: 'arrays-v0.5.0',
            commitCount: 0,
            currentVersion: '0.5.0',
            newVersion: '1.0.0',
            tag: 'arrays-v1.0.0',
            bumpedFiles: ['packages/arrays/package.json'],
            changelogFiles: ['packages/arrays/CHANGELOG.md'],
            setVersion: '1.0.0',
          },
        ],
        tags: ['arrays-v1.0.0'],
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).toContain('Using version override: 1.0.0');
      expect(output).toContain(`  📦 0.5.0 → ${bold('1.0.0')} (version override)`);
    });

    it('leaves propagated dependents of a setVersion workspace with a normal release-type label', () => {
      const result: PrepareResult = {
        workspaces: [
          {
            name: 'core',
            status: 'released',
            previousTag: 'core-v0.5.0',
            commitCount: 0,
            currentVersion: '0.5.0',
            newVersion: '1.0.0',
            tag: 'core-v1.0.0',
            bumpedFiles: ['packages/core/package.json'],
            changelogFiles: ['packages/core/CHANGELOG.md'],
            setVersion: '1.0.0',
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
            propagatedFrom: [{ packageName: '@test/core', newVersion: '1.0.0' }],
          },
        ],
        tags: ['core-v1.0.0', 'app-v2.0.1'],
        dryRun: false,
      };

      const output = reportPrepare(result);

      // core shows the version-override label.
      expect(output).toContain('Using version override: 1.0.0');
      expect(output).toContain(`  📦 0.5.0 → ${bold('1.0.0')} (version override)`);
      // app shows the normal dependency-propagation label.
      expect(output).toContain(`  📦 2.0.0 → ${bold('2.0.1')} (patch, dependency: @test/core)`);
    });

    it('formats a full skip in monorepo mode', () => {
      const result: PrepareResult = {
        workspaces: [
          {
            name: 'arrays',
            status: 'skipped',
            previousTag: 'arrays-v1.0.0',
            commitCount: 0,
            skipReason: 'No changes for arrays since arrays-v1.0.0. Skipping.',
          },
        ],
        tags: [],
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).toContain('⏭️  No workspaces had release-worthy changes.');
    });

    it('shows unparseable commit warning in monorepo mode', () => {
      const result: PrepareResult = {
        workspaces: [
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
        workspaces: [
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
        workspaces: [
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
          'Circular workspace dependencies detected among: a, b. Propagation metadata may be incomplete for these workspaces.',
        ],
      };

      const output = reportPrepare(result);

      expect(output).toContain('⚠️  Circular workspace dependencies detected among: a, b');
    });

    it('shows propagation info for a propagated-only workspace', () => {
      const result: PrepareResult = {
        workspaces: [
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

  describe('project release section', () => {
    it('renders the project section after workspace sections and before the tag summary', () => {
      const result: PrepareResult = {
        workspaces: [
          {
            name: 'arrays',
            status: 'released',
            previousTag: 'arrays-v1.0.0',
            commitCount: 1,
            parsedCommitCount: 1,
            releaseType: 'minor',
            currentVersion: '1.0.0',
            newVersion: '1.1.0',
            tag: 'arrays-v1.1.0',
            bumpedFiles: ['packages/arrays/package.json'],
            changelogFiles: ['packages/arrays/CHANGELOG.md'],
          },
        ],
        tags: ['arrays-v1.1.0', 'v0.10.0'],
        dryRun: false,
        project: {
          status: 'released',
          previousTag: 'v0.9.0',
          commitCount: 1,
          parsedCommitCount: 1,
          releaseType: 'minor',
          currentVersion: '0.9.0',
          newVersion: '0.10.0',
          tag: 'v0.10.0',
          bumpedFiles: ['./package.json'],
          changelogFiles: ['./CHANGELOG.md'],
          commits: [{ message: 'feat: add capability', hash: 'abc1234' }],
        },
      };

      const output = reportPrepare(result);

      expect(output).toContain(sectionHeader('project'));
      expect(output).toContain(`📦 0.9.0 → ${bold('0.10.0')} (minor)`);
      expect(output).toContain(`🏷️  ${bold('v0.10.0')}`);
      // Tag summary still includes both per-workspace and project tags.
      expect(output).toContain(`✅ Release preparation complete.`);
      expect(output).toContain(`🏷️  ${bold('arrays-v1.1.0')}`);
    });

    it('renders dry-run prefixes for project bumped and changelog files', () => {
      const result: PrepareResult = {
        workspaces: [],
        tags: ['v0.10.0'],
        dryRun: true,
        project: {
          status: 'released',
          previousTag: 'v0.9.0',
          commitCount: 1,
          parsedCommitCount: 1,
          releaseType: 'minor',
          currentVersion: '0.9.0',
          newVersion: '0.10.0',
          tag: 'v0.10.0',
          bumpedFiles: ['./package.json'],
          changelogFiles: ['./CHANGELOG.md'],
          commits: [{ message: 'feat: add capability', hash: 'abc1234' }],
        },
      };

      const output = reportPrepare(result);

      expect(output).toContain(dim('    [dry-run] Would bump ./package.json'));
      expect(output).toContain(dim('    [dry-run] Would run: npx --yes git-cliff ... --output ./CHANGELOG.md'));
    });

    it('omits the project section entirely when result.project is undefined', () => {
      const result: PrepareResult = {
        workspaces: [
          {
            name: 'arrays',
            status: 'released',
            previousTag: 'arrays-v1.0.0',
            commitCount: 1,
            parsedCommitCount: 1,
            releaseType: 'minor',
            currentVersion: '1.0.0',
            newVersion: '1.1.0',
            tag: 'arrays-v1.1.0',
            bumpedFiles: ['packages/arrays/package.json'],
            changelogFiles: ['packages/arrays/CHANGELOG.md'],
          },
        ],
        tags: ['arrays-v1.1.0'],
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).not.toContain(sectionHeader('project'));
    });

    it('renders "(no previous release found)" when project.previousTag is undefined on a released project', () => {
      const result: PrepareResult = {
        workspaces: [],
        tags: ['v0.1.0'],
        dryRun: false,
        project: {
          status: 'released',
          commitCount: 1,
          parsedCommitCount: 1,
          releaseType: 'minor',
          currentVersion: '0.0.0',
          newVersion: '0.1.0',
          tag: 'v0.1.0',
          bumpedFiles: ['./package.json'],
          changelogFiles: ['./CHANGELOG.md'],
          commits: [{ message: 'feat: add capability', hash: 'abc1234' }],
        },
      };

      const output = reportPrepare(result);

      expect(output).toContain(dim('  Found 1 commits (no previous release found)'));
    });

    it('renders the unparseable-commit warning block in a released project section', () => {
      const result: PrepareResult = {
        workspaces: [],
        tags: ['v0.9.1'],
        dryRun: false,
        project: {
          status: 'released',
          previousTag: 'v0.9.0',
          commitCount: 1,
          parsedCommitCount: 0,
          releaseType: 'patch',
          currentVersion: '0.9.0',
          newVersion: '0.9.1',
          tag: 'v0.9.1',
          bumpedFiles: ['./package.json'],
          changelogFiles: ['./CHANGELOG.md'],
          commits: [],
          unparseableCommits: [{ message: 'wip: undocumented', hash: 'abc1234def' }],
        },
      };

      const output = reportPrepare(result);

      expect(output).toContain('⚠️  1 commit could not be parsed (defaulting to patch bump)');
      expect(output).toContain('· abc1234 wip: undocumented');
    });

    it('renders a skipped project section as a header + commit count + skipReason', () => {
      // Mirrors the per-workspace skipped rendering: section header, "Found N commits"
      // line, and the skipReason — no bump-override line, no version line, no tag.
      const result: PrepareResult = {
        workspaces: [],
        tags: [],
        dryRun: false,
        project: {
          status: 'skipped',
          previousTag: 'v0.9.0',
          commitCount: 0,
          parsedCommitCount: 0,
          skipReason: 'No commits since v0.9.0. Pass --force to release at patch. Skipping.',
        },
      };

      const output = reportPrepare(result);

      expect(output).toContain(sectionHeader('project'));
      expect(output).toContain(dim('  Found 0 commits since v0.9.0'));
      expect(output).toContain('⏭️  No commits since v0.9.0. Pass --force to release at patch. Skipping.');
      // No version line, no bumped files, no changelog generation, no tag for a skipped project.
      expect(output).not.toContain('📦');
      expect(output).not.toContain('Bumping versions');
      expect(output).not.toContain('Generating changelogs...');
    });

    it('renders a skipped project section with parsedCommitCount but suppresses unparseable warnings', () => {
      // Diagnostic data (parsedCommitCount, unparseableCommits) remains on the structured
      // result for JSON output and tests, but the terminal rendering for skipped projects
      // intentionally suppresses these for symmetry with skipped workspace rendering.
      const result: PrepareResult = {
        workspaces: [],
        tags: [],
        dryRun: false,
        project: {
          status: 'skipped',
          previousTag: 'v0.9.0',
          commitCount: 1,
          parsedCommitCount: 0,
          unparseableCommits: [{ message: 'chore: deps', hash: 'abc1234' }],
          skipReason:
            'No bump-worthy commits since v0.9.0. Pass --force to release at patch (or --force --bump=X for a different level). Skipping.',
        },
      };

      const output = reportPrepare(result);

      expect(output).toContain(sectionHeader('project'));
      expect(output).toContain(dim('  Found 1 commits since v0.9.0'));
      expect(output).toContain('⏭️  No bump-worthy commits since v0.9.0');
      // Unparseable warning is intentionally suppressed in the skipped rendering.
      expect(output).not.toContain('could not be parsed');
      expect(output).not.toContain('Parsed 0 typed commits');
    });
  });

  describe('policy violations rendering', () => {
    it('renders a single-package result with one policy violation', () => {
      const result: PrepareResult = {
        workspaces: [
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
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).toContain('1 policy violation:');
      expect(output).toContain("· def5678 'internal!: refactor cache' — type 'internal' at prefix surface");
    });

    it('renders multiple policy violations with plural header', () => {
      const result: PrepareResult = {
        workspaces: [
          {
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
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).toContain('2 policy violations:');
      expect(output).toContain("· aaa1111 'internal!: refactor X' — type 'internal' at prefix surface");
      expect(output).toContain("· bbb2222 'drop: remove Y' — type 'drop' at prefix surface");
    });

    it('renders a workspace section in multi-workspace mode with policy violations', () => {
      const result: PrepareResult = {
        workspaces: [
          {
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
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).toContain('1 policy violation:');
      expect(output).toContain("· def5678 'internal!: refactor cache' — type 'internal' at prefix surface");
    });

    it('renders a project section with policy violations', () => {
      const result: PrepareResult = {
        workspaces: [],
        tags: ['v1.0.1'],
        dryRun: false,
        project: {
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
          commits: [{ message: 'internal!: refactor cache', hash: 'def5678' }],
          policyViolations: [
            {
              commitHash: 'def5678',
              commitSubject: 'internal!: refactor cache',
              type: 'internal',
              surface: 'prefix',
            },
          ],
        },
      };

      const output = reportPrepare(result);

      expect(output).toContain('1 policy violation:');
      expect(output).toContain("· def5678 'internal!: refactor cache' — type 'internal' at prefix surface");
    });

    it('omits the policy-violation block when policyViolations is undefined', () => {
      const result: PrepareResult = {
        workspaces: [
          {
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
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).not.toContain('policy violation');
    });

    it('truncates long commit subjects to 72 characters with ellipsis at 69', () => {
      const longSubject = `internal!: ${'x'.repeat(80)}`;
      const result: PrepareResult = {
        workspaces: [
          {
            status: 'released',
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
                commitSubject: longSubject,
                type: 'internal',
                surface: 'prefix',
              },
            ],
          },
        ],
        tags: ['v1.0.1'],
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).toContain(`'${longSubject.slice(0, 69)}...'`);
    });
  });
});
