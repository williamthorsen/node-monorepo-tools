import { measureWidth } from '@williamthorsen/nmr-core';
import { describe, expect, it } from 'vitest';

import { bold, dim, sectionHeader } from '../format.ts';
import { reportPrepare } from '../reportPrepare.ts';
import type {
  PolicyViolation,
  PrepareResult,
  ReleasedProjectResult,
  ReleasedWorkspaceResult,
  SkippedProjectResult,
  SkippedWorkspaceResult,
} from '../types.ts';

/** The column budget `reportPrepare` cuts a commit subject to. */
const SUBJECT_COLUMN_BUDGET = 72;

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
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).toContain(dim('Found 3 commits since v1.0.0'));
      expect(output).toContain(dim('  Parsed 2 typed commits'));
      expect(output).toContain(dim('Bumping versions (minor)...'));
      expect(output).toContain(`📦 1.0.0 → ${bold('1.1.0')} (minor)`);
      expect(output).toContain(dim('  Bumped package.json'));
      expect(output).toContain(dim('Generating changelogs...'));
      expect(output).toContain(dim('  Generating changelog: ./CHANGELOG.md'));
      expect(output).toContain('✅ Release preparation complete.');
      expect(output).toContain(`   🔖 ${bold('v1.1.0')}`);
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
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

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
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).toContain(dim('Found 1 commits since v1.0.0'));
      expect(output).toContain('⏩ No release-worthy changes found. Skipping.');
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
          files: ['package.json', './CHANGELOG.md'],
        },
      };

      const output = reportPrepare(result, { applied: false, style: 'rich' });

      expect(output).toContain(dim('  [dry-run] Would bump package.json'));
      expect(output).toContain(dim('  [dry-run] Would generate changelog: ./CHANGELOG.md'));
      expect(output).toContain(
        dim('\n  [dry-run] Would run format command: npx prettier --write package.json ./CHANGELOG.md'),
      );
    });

    it('names the failing format command and its error when formatting failed', () => {
      const result: PrepareResult = {
        workspaces: [makeReleasedWorkspace()],
        tags: ['v1.0.1'],
        formatCommand: { command: 'npx prettier --write package.json', files: ['package.json'] },
      };

      const output = reportPrepare(result, {
        applied: true,
        formatError: 'Command failed with exit code 2',
        style: 'rich',
      });

      expect(output).toContain('\n  🟠 Format command failed: npx prettier --write package.json');
      expect(output).toContain('     Command failed with exit code 2');
    });

    it('renders the release-notes preview files a release plans', () => {
      const result: PrepareResult = {
        workspaces: [
          makeReleasedWorkspace({
            previewFiles: ['docs/README.v1.0.1.md', 'docs/RELEASE_NOTES.v1.0.1.md'],
          }),
        ],
        tags: ['v1.0.1'],
      };

      expect(reportPrepare(result, { applied: true, style: 'rich' })).toContain(
        dim('  Wrote docs/RELEASE_NOTES.v1.0.1.md'),
      );
      expect(reportPrepare(result, { applied: false, style: 'rich' })).toContain(
        dim('  [dry-run] Would write docs/RELEASE_NOTES.v1.0.1.md'),
      );
    });

    it('surfaces warnings on a skipped single-package release', () => {
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
        warnings: ['packages/a: no changelog entry for version 1.0.1; skipping release-notes previews'],
      };

      expect(reportPrepare(result, { applied: true, style: 'rich' })).toContain(
        '🟠 packages/a: no changelog entry for version 1.0.1; skipping release-notes previews',
      );
    });

    it('surfaces warnings on a single-package release', () => {
      const result: PrepareResult = {
        workspaces: [makeReleasedWorkspace()],
        tags: ['v1.0.1'],
        warnings: ['README.md not found; skipping injected-README preview'],
      };

      expect(reportPrepare(result, { applied: true, style: 'rich' })).toContain(
        '🟠 README.md not found; skipping injected-README preview',
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
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

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
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).toContain('Using version override: 1.0.0');
      expect(output).toContain(`📦 0.5.0 → ${bold('1.0.0')} (version override)`);
      expect(output).not.toContain('Using bump override:');
    });

    it('shows unparseable commit warning when a forced release has no parsed commit', () => {
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
              { message: 'chore: update deps', subject: 'chore: update deps', hash: 'abc1234' },
              { message: 'misc: tidy up', subject: 'misc: tidy up', hash: 'def5678' },
            ],
          },
        ],
        tags: ['v1.0.1'],
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).toContain('🟠 2 commits could not be parsed\n');
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
            unparseableCommits: [{ message: 'chore: update deps', subject: 'chore: update deps', hash: 'abc1234' }],
          },
        ],
        tags: ['v1.1.0'],
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).toContain('🟠 1 commit could not be parsed');
      expect(output).not.toContain('defaulting to patch bump');
      expect(output).toContain('· abc1234 chore: update deps');
    });

    it('renders the subject alone for an unparseable commit that carries a body', () => {
      const result: PrepareResult = {
        workspaces: [
          {
            status: 'released',
            previousTag: 'v1.0.0',
            commitCount: 1,
            parsedCommitCount: 0,
            releaseType: 'patch',
            currentVersion: '1.0.0',
            newVersion: '1.0.1',
            tag: 'v1.0.1',
            bumpedFiles: ['package.json'],
            changelogFiles: ['./CHANGELOG.md'],
            unparseableCommits: [
              {
                message: 'chore: update deps\n\nBumps every transitive dependency to its latest release.',
                subject: 'chore: update deps',
                hash: 'abc1234',
              },
            ],
          },
        ],
        tags: ['v1.0.1'],
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).toContain('· abc1234 chore: update deps');
      expect(output).not.toContain('Bumps every transitive dependency');
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
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).not.toContain('🟠');
      expect(output).not.toContain('could not be parsed');
    });
  });

  describe('empty workspaces', () => {
    it('returns an empty string when workspaces array is empty', () => {
      const result: PrepareResult = {
        workspaces: [],
        tags: [],
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

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
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).toContain(sectionHeader('arrays'));
      expect(output).toContain(sectionHeader('strings'));
      expect(output).toContain(`  🔖 ${bold('arrays-v1.1.0')}`);
      expect(output).toContain(`  🔖 ${bold('strings-v2.0.1')}`);
      expect(output).toContain('✅ Release preparation complete.');
      expect(output).toContain(`   🔖 ${bold('arrays-v1.1.0')}`);
      expect(output).toContain(`   🔖 ${bold('strings-v2.0.1')}`);
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
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

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
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

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
            parsedCommitCount: 0,
            skipReason: 'No changes for strings since strings-v2.0.0. Skipping.',
          },
        ],
        tags: ['arrays-v1.0.1'],
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).toContain(sectionHeader('arrays'));
      expect(output).toContain(sectionHeader('strings'));
      expect(output).toContain('  ⏩ No changes for strings since strings-v2.0.0. Skipping.');
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
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

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
            propagatedOnly: true,
          },
        ],
        tags: ['core-v1.0.0', 'app-v2.0.1'],
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

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
            parsedCommitCount: 0,
            skipReason: 'No changes for arrays since arrays-v1.0.0. Skipping.',
          },
        ],
        tags: [],
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).toContain('⏩ No workspaces had release-worthy changes.');
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
            unparseableCommits: [{ message: 'chore: update deps', subject: 'chore: update deps', hash: 'abc1234' }],
          },
        ],
        tags: ['arrays-v1.0.1'],
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).toContain('🟠 1 commit could not be parsed\n');
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
          files: ['packages/arrays/package.json', 'packages/arrays/CHANGELOG.md'],
        },
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

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
        warnings: [
          'Circular workspace dependencies detected among: a, b. Propagation metadata may be incomplete for these workspaces.',
        ],
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).toContain('🟠 Circular workspace dependencies detected among: a, b');
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
            propagatedOnly: true,
          },
        ],
        tags: ['core-v1.0.1', 'app-v2.0.1'],
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).toContain(dim('  Bumped via dependency: @scope/core'));
      expect(output).toContain('(patch, dependency: @scope/core)');
    });

    it("renders a propagated-only workspace's own commits and diagnostics", () => {
      const result: PrepareResult = {
        workspaces: [
          {
            name: 'app',
            status: 'released',
            previousTag: 'app-v2.0.0',
            commitCount: 2,
            commits: [
              { message: 'Merge PR', subject: 'Merge PR', hash: 'bbb2222' },
              { message: 'tidy up', subject: 'tidy up', hash: 'ccc3333' },
            ],
            unparseableCommits: [{ message: 'tidy up', subject: 'tidy up', hash: 'ccc3333' }],
            policyViolations: [
              { commitHash: 'bbb2222', commitSubject: 'Merge PR', type: 'drop', surface: 'entry', entryPosition: 1 },
            ],
            releaseType: 'patch',
            currentVersion: '2.0.0',
            newVersion: '2.0.1',
            tag: 'app-v2.0.1',
            bumpedFiles: ['packages/app/package.json'],
            changelogFiles: ['packages/app/CHANGELOG.md'],
            propagatedFrom: [{ packageName: '@scope/core', newVersion: '1.0.1' }],
            propagatedOnly: true,
          },
        ],
        tags: ['app-v2.0.1'],
      };

      const output = reportPrepare(result, { applied: true, style: 'plain' });

      expect(output).toContain(dim('  Found 2 commits since app-v2.0.0'));
      expect(output).toContain('1 commit could not be parsed');
      expect(output).toContain('1 policy violation:');
      expect(output).toContain(dim('  Bumped via dependency: @scope/core'));
      expect(output).toContain('(patch, dependency: @scope/core)');
    });

    it('omits the propagation label from a direct release that a dependency also bumps', () => {
      const result: PrepareResult = {
        workspaces: [
          {
            name: 'app',
            status: 'released',
            previousTag: 'app-v2.0.0',
            commitCount: 0,
            parsedCommitCount: 0,
            releaseType: 'patch',
            currentVersion: '2.0.0',
            newVersion: '2.0.1',
            tag: 'app-v2.0.1',
            bumpedFiles: ['packages/app/package.json'],
            changelogFiles: ['packages/app/CHANGELOG.md'],
            propagatedFrom: [{ packageName: '@scope/core', newVersion: '1.0.1' }],
          },
        ],
        tags: ['app-v2.0.1'],
      };

      const output = reportPrepare(result, { applied: true, style: 'plain' });

      expect(output).not.toContain('Bumped via dependency');
      expect(output).not.toContain('dependency: @scope/core');
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
          commits: [{ message: 'feat: add capability', subject: 'feat: add capability', hash: 'abc1234' }],
        },
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).toContain(sectionHeader('project'));
      expect(output).toContain(`📦 0.9.0 → ${bold('0.10.0')} (minor)`);
      expect(output).toContain(`🔖 ${bold('v0.10.0')}`);
      // Tag summary still includes both per-workspace and project tags.
      expect(output).toContain(`✅ Release preparation complete.`);
      expect(output).toContain(`🔖 ${bold('arrays-v1.1.0')}`);
    });

    it('renders dry-run prefixes for project bumped and changelog files', () => {
      const result: PrepareResult = {
        workspaces: [],
        tags: ['v0.10.0'],
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
          commits: [{ message: 'feat: add capability', subject: 'feat: add capability', hash: 'abc1234' }],
        },
      };

      const output = reportPrepare(result, { applied: false, style: 'rich' });

      expect(output).toContain(dim('    [dry-run] Would bump ./package.json'));
      expect(output).toContain(dim('    [dry-run] Would generate changelog: ./CHANGELOG.md'));
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
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).not.toContain(sectionHeader('project'));
    });

    it('renders "(no previous release found)" when project.previousTag is undefined on a released project', () => {
      const result: PrepareResult = {
        workspaces: [],
        tags: ['v0.1.0'],
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
          commits: [{ message: 'feat: add capability', subject: 'feat: add capability', hash: 'abc1234' }],
        },
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).toContain(dim('  Found 1 commits (no previous release found)'));
    });

    it('renders the unparseable-commit warning block in a released project section', () => {
      const result: PrepareResult = {
        workspaces: [],
        tags: ['v0.9.1'],
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
          unparseableCommits: [{ message: 'wip: undocumented', subject: 'wip: undocumented', hash: 'abc1234def' }],
        },
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).toContain('🟠 1 commit could not be parsed\n');
      expect(output).toContain('· abc1234 wip: undocumented');
    });

    it('renders a skipped project section as a header + commit count + skipReason', () => {
      // Mirrors the per-workspace skipped rendering: section header, "Found N commits"
      // line, and the skipReason — no bump-override line, no version line, no tag.
      const result: PrepareResult = {
        workspaces: [],
        tags: [],
        project: {
          status: 'skipped',
          previousTag: 'v0.9.0',
          commitCount: 0,
          parsedCommitCount: 0,
          skipReason: 'No commits since v0.9.0. Pass --force to release at patch. Skipping.',
        },
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).toContain(sectionHeader('project'));
      expect(output).toContain(dim('  Found 0 commits since v0.9.0'));
      expect(output).toContain('⏩ No commits since v0.9.0. Pass --force to release at patch. Skipping.');
      // No version line, no bumped files, no changelog generation, no tag for a skipped project.
      expect(output).not.toContain('📦');
      expect(output).not.toContain('Bumping versions');
      expect(output).not.toContain('Generating changelogs...');
    });

    it('renders a skipped project section with its unparseable commits and no parsed count', () => {
      const result: PrepareResult = {
        workspaces: [],
        tags: [],
        project: {
          status: 'skipped',
          previousTag: 'v0.9.0',
          commitCount: 1,
          parsedCommitCount: 0,
          unparseableCommits: [{ message: 'chore: deps', subject: 'chore: deps', hash: 'abc1234' }],
          skipReason:
            'No bump-worthy commits since v0.9.0. Pass --force to release at patch (or --force --bump=X for a different level). Skipping.',
        },
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).toContain(sectionHeader('project'));
      expect(output).toContain(dim('  Found 1 commits since v0.9.0'));
      expect(output).toContain('⏩ No bump-worthy commits since v0.9.0');
      expect(output).toContain('🟠 1 commit could not be parsed\n');
      expect(output).toContain('· abc1234 chore: deps');
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
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

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
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

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
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).toContain('1 policy violation:');
      expect(output).toContain("· def5678 'internal!: refactor cache' — type 'internal' at prefix surface");
    });

    it('renders a project section with policy violations', () => {
      const result: PrepareResult = {
        workspaces: [],
        tags: ['v1.0.1'],
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
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

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
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).not.toContain('policy violation');
    });

    it('cuts a long commit subject to the column budget, marking the cut with an ellipsis', () => {
      const output = reportViolation(`internal!: ${'x'.repeat(80)}`);

      const subject = readViolationSubject(output);
      expect(measureWidth(subject)).toBeLessThanOrEqual(SUBJECT_COLUMN_BUDGET);
      expect(subject.endsWith('…')).toBe(true);
    });

    it('cuts a subject of wide characters by column rather than by code unit', () => {
      // 71 code units, which the budget admits, and 141 columns, which it does not.
      const output = reportViolation(`x${'発'.repeat(70)}`);

      expect(measureWidth(readViolationSubject(output))).toBeLessThanOrEqual(SUBJECT_COLUMN_BUDGET);
    });

    it('cuts a subject at a grapheme boundary rather than inside an emoji sequence', () => {
      // The old code-unit cut fell inside the ZWJ sequence; the column budget admits the sequence whole.
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
    const diagnostics: Pick<ReleasedWorkspaceResult, 'malformedBlocks' | 'policyViolations' | 'undeclaredEntryTypes'> =
      {
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
      `· abc1234 '${SUBJECT}' — \`entries[0].text\` is missing`,
      '1 change-record entry has an undeclared type (no item):',
      `· abc1234 '${SUBJECT}' — type 'chore' at entry 2`,
      '1 policy violation:',
      `· abc1234 '${SUBJECT}' — type 'drop' at entry 3`,
    ];

    it('renders each diagnostic kind in a single-package report', () => {
      const output = reportPrepare(
        { workspaces: [makeReleasedWorkspace(diagnostics)], tags: ['v1.0.1'] },
        { applied: false, style: 'rich' },
      );

      for (const line of expectedLines) {
        expect(output).toContain(line);
      }
    });

    it('renders each diagnostic kind in a monorepo workspace section', () => {
      const output = reportPrepare(
        { workspaces: [makeReleasedWorkspace({ name: 'arrays', ...diagnostics })], tags: ['arrays-v1.0.1'] },
        { applied: false, style: 'rich' },
      );

      for (const line of expectedLines) {
        expect(output).toContain(line);
      }
    });

    it('renders each diagnostic kind in a project section', () => {
      const project: ReleasedProjectResult = {
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

      const output = reportPrepare({ workspaces: [], tags: ['v1.0.1'], project }, { applied: false, style: 'rich' });

      for (const line of expectedLines) {
        expect(output).toContain(line);
      }
    });

    it('renders each diagnostic kind and the unparseable commits in a skipped single-package report', () => {
      const output = reportPrepare(
        { workspaces: [makeSkippedWorkspace({ ...diagnostics, unparseableCommits })], tags: [] },
        { applied: false, style: 'rich' },
      );

      for (const line of [...expectedLines, ...expectedUnparseableLines]) {
        expect(output).toContain(line);
      }
    });

    it('renders each diagnostic kind and the unparseable commits in a skipped monorepo workspace section', () => {
      const output = reportPrepare(
        { workspaces: [makeSkippedWorkspace({ name: 'arrays', ...diagnostics, unparseableCommits })], tags: [] },
        { applied: false, style: 'rich' },
      );

      for (const line of [...expectedLines, ...expectedUnparseableLines]) {
        expect(output).toContain(line);
      }
    });

    it('renders each diagnostic kind and the unparseable commits in a skipped project section', () => {
      const project: SkippedProjectResult = {
        status: 'skipped',
        commitCount: 2,
        parsedCommitCount: 0,
        skipReason: 'No bump-worthy commits since v1.0.0. Skipping.',
        unparseableCommits,
        ...diagnostics,
      };

      const output = reportPrepare({ workspaces: [], tags: [], project }, { applied: false, style: 'rich' });

      for (const line of [...expectedLines, ...expectedUnparseableLines]) {
        expect(output).toContain(line);
      }
    });

    it('pluralizes the headers', () => {
      const block = { commitHash: 'abc1234', commitSubject: SUBJECT, reason: 'bad' };
      const entry = { commitHash: 'abc1234', commitSubject: SUBJECT, entryPosition: 1, type: 'chore' };
      const output = reportPrepare(
        {
          workspaces: [
            makeReleasedWorkspace({ malformedBlocks: [block, block], undeclaredEntryTypes: [entry, entry] }),
          ],
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
        { workspaces: [makeWorkspace({ name: 'arrays', unroutedEntryScopes })], tags: [] },
        { applied: false, style: 'rich' },
      );

      expect(output).toContain(
        "1 change-record entry scope matches no workspace in the commit's window (no item there):",
      );
      expect(output).toContain(`· abc1234 '${SUBJECT}' — scope 'nmr' at entry 2`);
    });

    it('pluralizes the unrouted entry scopes header', () => {
      const finding = { commitHash: 'abc1234', commitSubject: SUBJECT, entryPosition: 1, scope: 'nmr' };

      const output = reportPrepare(
        { workspaces: [makeReleasedWorkspace({ name: 'arrays', unroutedEntryScopes: [finding, finding] })], tags: [] },
        { applied: false, style: 'rich' },
      );

      expect(output).toContain(
        "2 change-record entry scopes match no workspace in the commit's window (no item there):",
      );
    });

    it('renders no change-record lines when the result carries none', () => {
      const output = reportPrepare(
        { workspaces: [makeReleasedWorkspace()], tags: ['v1.0.1'] },
        { applied: false, style: 'rich' },
      );

      expect(output).not.toContain('change-record');
    });
  });

  describe('plain style', () => {
    const unparseableCommits = [{ message: 'tidy things up', subject: 'tidy things up', hash: 'abc1234def' }];
    const policyViolations: PolicyViolation[] = [
      { commitHash: 'fed4321cba', commitSubject: 'feat!: drop the old API', type: 'feat', surface: 'prefix' },
    ];
    const formatCommand = { command: 'npx prettier --write package.json', files: ['package.json'] };
    const released = makeReleasedWorkspace({ unparseableCommits, policyViolations });
    // A version override carries no release type.
    const { releaseType: _releaseType, ...untyped } = released;
    const overridden: ReleasedWorkspaceResult = { ...untyped, setVersion: '3.0.0' };

    // Together the fixtures populate every glyph-bearing branch of the formatter.
    const fixtures: Array<{ name: string; result: PrepareResult }> = [
      {
        name: 'a released single package',
        result: { workspaces: [released], tags: ['v1.0.1'], formatCommand, warnings: ['README.md not found'] },
      },
      {
        name: 'a single package released by version override',
        result: { workspaces: [overridden], tags: ['v3.0.0'] },
      },
      {
        name: 'a skipped single package',
        result: {
          workspaces: [
            {
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
          workspaces: [
            { ...released, name: 'arrays', tag: 'arrays-v1.0.1' },
            { ...overridden, name: 'strings', tag: 'strings-v3.0.0' },
            {
              status: 'skipped',
              name: 'numbers',
              commitCount: 0,
              parsedCommitCount: 0,
              skipReason: 'No changes for numbers.',
            },
          ],
          tags: ['arrays-v1.0.1', 'strings-v3.0.0', 'v0.9.1'],
          formatCommand,
          warnings: ['Circular workspace dependencies detected among: a, b'],
          project: {
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
        },
      },
      {
        name: 'a monorepo in which nothing is released',
        result: {
          workspaces: [
            { status: 'skipped', name: 'numbers', commitCount: 0, parsedCommitCount: 0, skipReason: 'No changes.' },
          ],
          tags: [],
          project: {
            status: 'skipped',
            commitCount: 0,
            parsedCommitCount: 0,
            policyViolations,
            skipReason: 'No commits.',
          },
        },
      },
    ];

    it.each(fixtures)('renders $name without a pictographic character', ({ result }) => {
      const options = { applied: true, formatError: 'Command failed with exit code 2' };

      // The rich render proves that the fixture reaches glyph-bearing branches.
      expect(reportPrepare(result, { ...options, style: 'rich' })).toMatch(/\p{Extended_Pictographic}/u);
      expect(reportPrepare(result, { ...options, style: 'plain' })).not.toMatch(/\p{Extended_Pictographic}/u);
    });

    it('replaces each glyph with its plain marker', () => {
      const result: PrepareResult = {
        workspaces: [released],
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
        workspaces: [{ status: 'skipped', commitCount: 0, parsedCommitCount: 0, skipReason: 'No changes. Skipping.' }],
        tags: [],
      };

      const output = reportPrepare(result, { applied: true, style: 'plain' });

      expect(output).toContain('SKIP  No changes. Skipping.');
    });
  });
});

/** Reports whether a code point is a surrogate, which a cut inside a surrogate pair leaves behind. */
function isSurrogate(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint >= 0xd800 && codePoint <= 0xdfff;
}

/** Build a released single-package workspace result, overriding any field. */
function makeReleasedWorkspace(overrides: Partial<ReleasedWorkspaceResult> = {}): ReleasedWorkspaceResult {
  return {
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
    ...overrides,
  };
}

/** Builds a skipped workspace result, with the given fields overriding a bump-less default. */
function makeSkippedWorkspace(overrides: Partial<SkippedWorkspaceResult> = {}): SkippedWorkspaceResult {
  return {
    status: 'skipped',
    previousTag: 'v1.0.0',
    commitCount: 2,
    parsedCommitCount: 0,
    skipReason: 'No bump-worthy commits since v1.0.0. Skipping.',
    ...overrides,
  };
}

/** Reads back the subject the policy-violation bullet rendered, which the report quotes. */
function readViolationSubject(output: string): string {
  const match = /· \w+ '(.*)' — type /.exec(output);
  if (match?.[1] === undefined) {
    throw new Error(`No policy-violation bullet in output:\n${output}`);
  }
  return match[1];
}

/** Renders a report whose one policy violation carries `commitSubject`. */
function reportViolation(commitSubject: string): string {
  const result: PrepareResult = {
    workspaces: [
      makeReleasedWorkspace({
        policyViolations: [{ commitHash: 'def5678', commitSubject, type: 'internal', surface: 'prefix' }],
      }),
    ],
    tags: ['v1.0.1'],
  };
  return reportPrepare(result, { applied: true, style: 'rich' });
}
