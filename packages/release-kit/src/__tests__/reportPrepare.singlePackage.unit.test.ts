import { describe, expect, it } from 'vitest';

import { bold, dim } from '../format.ts';
import { reportPrepare } from '../reportPrepare.ts';
import { makeReleasedWorkspace } from '../test-utils/reportPrepareFixtures.ts';
import type { PrepareResult } from '../types.ts';

describe(reportPrepare, () => {
  describe('single-package mode', () => {
    it('formats a successful single-package release', () => {
      const result: PrepareResult = {
        targets: [
          {
            targetId: '.',
            kind: 'package',
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
        targets: [
          {
            targetId: '.',
            kind: 'package',
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
        targets: [
          {
            targetId: '.',
            kind: 'package',
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
        targets: [makeReleasedWorkspace()],
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

    it('renders the release-notes preview files that a release plans', () => {
      const result: PrepareResult = {
        targets: [
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

    it('shows warnings on a skipped single-package release', () => {
      const result: PrepareResult = {
        targets: [
          {
            targetId: '.',
            kind: 'package',
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

    it('shows warnings on a single-package release', () => {
      const result: PrepareResult = {
        targets: [makeReleasedWorkspace()],
        tags: ['v1.0.1'],
        warnings: ['README.md not found; skipping injected-README preview'],
      };

      expect(reportPrepare(result, { applied: true, style: 'rich' })).toContain(
        '🟠 README.md not found; skipping injected-README preview',
      );
    });

    it('formats a release with bump override', () => {
      const result: PrepareResult = {
        targets: [
          {
            targetId: '.',
            kind: 'package',
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
        targets: [
          {
            targetId: '.',
            kind: 'package',
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

    it('shows unparseable commit warning when a forced release does not have any parsed commit', () => {
      const result: PrepareResult = {
        targets: [
          {
            targetId: '.',
            kind: 'package',
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
        targets: [
          {
            targetId: '.',
            kind: 'package',
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

    it('renders the subject alone for an unparseable commit that has a body', () => {
      const result: PrepareResult = {
        targets: [
          {
            targetId: '.',
            kind: 'package',
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

    it('does not show unparseable warning when the result does not contain any unparseable commits', () => {
      const result: PrepareResult = {
        targets: [
          {
            targetId: '.',
            kind: 'package',
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
});
