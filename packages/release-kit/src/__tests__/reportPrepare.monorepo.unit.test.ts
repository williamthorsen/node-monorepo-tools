import { describe, expect, it } from 'vitest';

import { bold, dim, renderSectionHeader } from '../format.ts';
import { reportPrepare } from '../reportPrepare.ts';
import type { PrepareResult } from '../types.ts';

describe(reportPrepare, () => {
  describe('empty workspaces', () => {
    it('returns an empty string when workspaces array is empty', () => {
      const result: PrepareResult = {
        targets: [],
        tags: [],
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).toBe('');
    });
  });

  describe('monorepo mode', () => {
    it('formats a multi-workspace release', () => {
      const result: PrepareResult = {
        targets: [
          {
            targetId: 'arrays',
            kind: 'package',
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
            targetId: 'strings',
            kind: 'package',
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

      expect(output).toContain(renderSectionHeader('arrays'));
      expect(output).toContain(renderSectionHeader('strings'));
      expect(output).toContain(`  🔖 ${bold('arrays-v1.1.0')}`);
      expect(output).toContain(`  🔖 ${bold('strings-v2.0.1')}`);
      expect(output).toContain('✅ Release preparation complete.');
      expect(output).toContain(`   🔖 ${bold('arrays-v1.1.0')}`);
      expect(output).toContain(`   🔖 ${bold('strings-v2.0.1')}`);
    });

    it('renders "(no previous release found)" when previousTag is undefined', () => {
      const result: PrepareResult = {
        targets: [
          {
            targetId: 'arrays',
            kind: 'package',
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

    it('renders the changelog header without any file entries when changelogFiles is empty', () => {
      const result: PrepareResult = {
        targets: [
          {
            targetId: 'arrays',
            kind: 'package',
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
        targets: [
          {
            targetId: 'arrays',
            kind: 'package',
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
            targetId: 'strings',
            kind: 'package',
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

      expect(output).toContain(renderSectionHeader('arrays'));
      expect(output).toContain(renderSectionHeader('strings'));
      expect(output).toContain('  ⏩ No changes for strings since strings-v2.0.0. Skipping.');
      expect(output).toContain('✅ Release preparation complete.');
    });

    it('renders "version override" labels for a setVersion workspace in monorepo mode', () => {
      const result: PrepareResult = {
        targets: [
          {
            targetId: 'arrays',
            kind: 'package',
            name: 'arrays',
            status: 'released',
            previousTag: 'arrays-v0.5.0',
            commitCount: 0,
            currentVersion: '0.5.0',
            newVersion: '1.0.0',
            tag: 'arrays-v1.0.0',
            bumpedFiles: ['packages/arrays/package.json'],
            changelogFiles: ['packages/arrays/CHANGELOG.md'],
            versionOverride: '1.0.0',
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
        targets: [
          {
            targetId: 'core',
            kind: 'package',
            name: 'core',
            status: 'released',
            previousTag: 'core-v0.5.0',
            commitCount: 0,
            currentVersion: '0.5.0',
            newVersion: '1.0.0',
            tag: 'core-v1.0.0',
            bumpedFiles: ['packages/core/package.json'],
            changelogFiles: ['packages/core/CHANGELOG.md'],
            versionOverride: '1.0.0',
          },
          {
            targetId: 'app',
            kind: 'package',
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
        targets: [
          {
            targetId: 'arrays',
            kind: 'package',
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

      expect(output).toContain('⏩ The run did not find release-worthy changes in any workspace.');
    });

    it('shows unparseable commit warning in monorepo mode', () => {
      const result: PrepareResult = {
        targets: [
          {
            targetId: 'arrays',
            kind: 'package',
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
        targets: [
          {
            targetId: 'arrays',
            kind: 'package',
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
        targets: [
          {
            targetId: 'core',
            kind: 'package',
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
        targets: [
          {
            targetId: 'core',
            kind: 'package',
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
            targetId: 'app',
            kind: 'package',
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
        targets: [
          {
            targetId: 'app',
            kind: 'package',
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
        targets: [
          {
            targetId: 'app',
            kind: 'package',
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
});
