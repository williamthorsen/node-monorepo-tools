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
            skipReason: 'No release-worthy changes found',
          },
        ],
        tags: [],
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).toContain(dim('Found 1 commits since v1.0.0'));
      expect(output).toContain('⏭️  No release-worthy changes found');
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
            skipReason: 'No changes for strings since strings-v2.0.0',
          },
        ],
        tags: ['arrays-v1.0.1'],
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).toContain(sectionHeader('arrays'));
      expect(output).toContain(sectionHeader('strings'));
      expect(output).toContain('  ⏭️  No changes for strings since strings-v2.0.0');
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
            skipReason: 'No changes for arrays since arrays-v1.0.0',
          },
        ],
        tags: [],
        dryRun: false,
      };

      const output = reportPrepare(result);

      expect(output).toContain('⏭️  No components had release-worthy changes.');
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
  });
});
