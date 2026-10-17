import { describe, expect, it } from 'vitest';

import { bold, dim, sectionHeader } from '../format.ts';
import { reportPrepare } from '../reportPrepare.ts';
import type { PrepareResult, ReleasedCompositeResult, ReleasedPackageResult } from '../types.ts';

describe(reportPrepare, () => {
  describe('project release section', () => {
    it('renders the project section after workspace sections and before the tag summary', () => {
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
            releaseType: 'minor',
            currentVersion: '1.0.0',
            newVersion: '1.1.0',
            tag: 'arrays-v1.1.0',
            bumpedFiles: ['packages/arrays/package.json'],
            changelogFiles: ['packages/arrays/CHANGELOG.md'],
          },
          {
            targetId: '',
            kind: 'composite',
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
        ],
        tags: ['arrays-v1.1.0', 'v0.10.0'],
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
        targets: [
          {
            targetId: '',
            kind: 'composite',
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
        ],
        tags: ['v0.10.0'],
      };

      const output = reportPrepare(result, { applied: false, style: 'rich' });

      expect(output).toContain(dim('    [dry-run] Would bump ./package.json'));
      expect(output).toContain(dim('    [dry-run] Would generate changelog: ./CHANGELOG.md'));
    });

    it('omits the project section entirely when the plan lacks a composite result', () => {
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
        targets: [
          {
            targetId: '',
            kind: 'composite',
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
        ],
        tags: ['v0.1.0'],
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).toContain(dim('  Found 1 commits (no previous release found)'));
    });

    it('renders the unparseable-commit warning block in a released project section', () => {
      const result: PrepareResult = {
        targets: [
          {
            targetId: '',
            kind: 'composite',
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
        ],
        tags: ['v0.9.1'],
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).toContain('🟠 1 commit could not be parsed\n');
      expect(output).toContain('· abc1234 wip: undocumented');
    });

    it('heads a named composite section with its name', () => {
      const result: PrepareResult = {
        targets: [
          {
            targetId: 'suite',
            kind: 'composite',
            status: 'skipped',
            commitCount: 0,
            parsedCommitCount: 0,
            skipReason: 'No commits. Skipping.',
          },
        ],
        tags: [],
      };

      const output = reportPrepare(result, { applied: true, style: 'rich' });

      expect(output).toContain(sectionHeader('suite'));
      expect(output).not.toContain(sectionHeader('project'));
    });

    it('renders a skipped project section as a header + commit count + skipReason', () => {
      const result: PrepareResult = {
        targets: [
          {
            targetId: '',
            kind: 'composite',
            status: 'skipped',
            previousTag: 'v0.9.0',
            commitCount: 0,
            parsedCommitCount: 0,
            skipReason: 'No commits since v0.9.0. Pass --force to release at patch. Skipping.',
          },
        ],
        tags: [],
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

    it('renders a skipped project section with its unparseable commits and without a parsed count', () => {
      const result: PrepareResult = {
        targets: [
          {
            targetId: '',
            kind: 'composite',
            status: 'skipped',
            previousTag: 'v0.9.0',
            commitCount: 1,
            parsedCommitCount: 0,
            unparseableCommits: [{ message: 'chore: deps', subject: 'chore: deps', hash: 'abc1234' }],
            skipReason:
              'No bump-worthy commits since v0.9.0. Pass --force to release at patch (or --force --bump=X for a different level). Skipping.',
          },
        ],
        tags: [],
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

  describe('existing changelog sections', () => {
    const preservingRelease: ReleasedPackageResult = {
      targetId: '.',
      kind: 'package',
      status: 'released',
      previousTag: 'v1.0.0',
      commitCount: 1,
      releaseType: 'minor',
      currentVersion: '1.0.0',
      newVersion: '1.1.0',
      tag: 'v1.1.0',
      bumpedFiles: ['package.json'],
      changelogFiles: ['CHANGELOG.md', 'docs/CHANGELOG.md'],
      changelogPreservation: [
        { file: 'CHANGELOG.md', preservedVersions: ['0.9.0', '0.8.0'], droppedUnversionedHeadings: [] },
        {
          file: 'docs/CHANGELOG.md',
          preservedVersions: [],
          droppedUnversionedHeadings: ['## Unreleased', '## Notes'],
        },
      ],
    };

    it('lists the kept versions and warns about the dropped sections under each changelog file', () => {
      const output = reportPrepare(
        { targets: [preservingRelease], tags: ['v1.1.0'] },
        { applied: false, style: 'plain' },
      );

      expect(output).toContain(
        [
          dim('  [dry-run] Would generate changelog: CHANGELOG.md'),
          dim('    Kept from the existing changelog: 0.9.0, 0.8.0'),
          dim('  [dry-run] Would generate changelog: docs/CHANGELOG.md'),
          '    WARN  Dropped 2 sections without a version: ## Unreleased, ## Notes',
        ].join('\n'),
      );
    });

    it('lists archive files under the generated changelogs and removed archive files after them', () => {
      const archivingRelease = {
        ...preservingRelease,
        changelogFiles: ['CHANGELOG.md', 'changelogs/CHANGELOG-v0.md'],
        removedChangelogFiles: ['changelogs/CHANGELOG-v1.md'],
      };
      const { changelogPreservation: _, ...withoutPreservation } = archivingRelease;

      const dryRunOutput = reportPrepare(
        { targets: [withoutPreservation], tags: ['v1.1.0'] },
        { applied: false, style: 'plain' },
      );
      const appliedOutput = reportPrepare(
        { targets: [withoutPreservation], tags: ['v1.1.0'] },
        { applied: true, style: 'plain' },
      );

      expect(dryRunOutput).toContain(
        [
          dim('  [dry-run] Would generate changelog: CHANGELOG.md'),
          dim('  [dry-run] Would generate changelog: changelogs/CHANGELOG-v0.md'),
          dim('  [dry-run] Would remove changelog: changelogs/CHANGELOG-v1.md'),
        ].join('\n'),
      );
      expect(appliedOutput).toContain(dim('  Removing changelog: changelogs/CHANGELOG-v1.md'));
    });

    it('reports kept versions for a monorepo workspace and the project', () => {
      const project: ReleasedCompositeResult = {
        targetId: '',
        kind: 'composite',
        status: 'released',
        commitCount: 1,
        parsedCommitCount: 1,
        releaseType: 'minor',
        currentVersion: '1.0.0',
        newVersion: '1.1.0',
        tag: 'v1.1.0',
        bumpedFiles: ['./package.json'],
        changelogFiles: ['CHANGELOG.md'],
        commits: [],
        changelogPreservation: [
          { file: 'CHANGELOG.md', preservedVersions: ['0.5.0'], droppedUnversionedHeadings: ['## Credits'] },
        ],
      };

      const output = reportPrepare(
        {
          targets: [{ ...preservingRelease, targetId: 'core', name: 'core' }, project],
          tags: ['core-v1.1.0', 'v1.1.0'],
        },
        { applied: true, style: 'plain' },
      );

      expect(output).toContain(dim('      Kept from the existing changelog: 0.9.0, 0.8.0'));
      expect(output).toContain(
        [
          dim('    Generating changelog: CHANGELOG.md'),
          dim('      Kept from the existing changelog: 0.5.0'),
          '      WARN  Dropped 1 section without a version: ## Credits',
        ].join('\n'),
      );
    });
  });
});
