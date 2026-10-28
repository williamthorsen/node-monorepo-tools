import { captureError } from '@williamthorsen/toolbelt.testing/candidate';
import { silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  applyPrepareReleaseTargetsMonorepoDefaults,
  listReadOptions,
  mockBuildEmptyReleaseEntry,
  mockBuildSyntheticChangelogEntry,
  mockExecFileSync,
  mockExecSync,
  mockExistsSync,
  mockHasPrettierConfig,
  mockMergeChangelogEntriesWithDisk,
  mockPlanReleaseNotesPreviews,
  mockReadFileSync,
  mockReadReleaseHistory,
  mockRenderChangelogJson,
  mockRenderChangelogMarkdown,
  mockWriteFileSync,
  resetPrepareReleaseTargetsMonorepoMocks,
  stubHistory,
  stubHistoryByPrefix,
} = await vi.hoisted(() => import('../test-utils/prepareReleaseTargetsMonorepoMocks.ts'));

vi.mock(import('node:child_process'), () => ({
  execFileSync: mockExecFileSync,
  execSync: mockExecSync,
}));

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

vi.mock(import('../hasPrettierConfig.ts'), () => ({
  hasPrettierConfig: mockHasPrettierConfig,
}));

vi.mock(import('../planReleaseNotesPreviews.ts'), () => ({
  planReleaseNotesPreviews: mockPlanReleaseNotesPreviews,
}));

// Stub the history reader and the changelog constructors and renderers. The default stubs return
// deterministic values without reading git history or touching the filesystem; `convertToChangelogEntries`
// stays real, so the planned changelog contains a history's sections, labeled with the new tag.
vi.mock(import('../buildChangelogEntries.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  readReleaseHistory: mockReadReleaseHistory,
}));

vi.mock(import('../buildSyntheticChangelogEntry.ts'), () => ({
  buildSyntheticChangelogEntry: mockBuildSyntheticChangelogEntry,
}));

vi.mock(import('../buildEmptyReleaseEntry.ts'), () => ({
  buildEmptyReleaseEntry: mockBuildEmptyReleaseEntry,
}));

vi.mock(import('../changelogJsonFile.ts'), () => ({
  resolveChangelogJsonPath: (config: { changelogJson: { outputPath: string } }, changelogPath: string): string =>
    `${changelogPath}/${config.changelogJson.outputPath}`,
  renderChangelogJson: mockRenderChangelogJson,
  mergeChangelogEntriesWithDisk: mockMergeChangelogEntriesWithDisk,
}));

vi.mock(import('../renderChangelogMarkdown.ts'), () => ({
  renderChangelogFiles: (entries: unknown, options: unknown) => ({
    main: String(mockRenderChangelogMarkdown(entries, options)),
    archives: [],
  }),
}));

vi.mock(import('../changelogArchive.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  listArchiveFiles: () => [],
}));

import { DEFAULT_CHANGELOG_JSON_CONFIG } from '../defaults.ts';
import { selectCompositeResult, selectPackageResults } from '../test-utils/prepareResults.ts';
import { makeReleaseHistory } from '../test-utils/releaseHistories.ts';
import {
  makeConfig,
  findPlannedContent,
  prepareMonorepo,
  stubPropagationWorkspaces,
} from '../test-utils/prepareReleaseTargetsMonorepoFixtures.ts';
import type { MonorepoReleaseConfig } from '../types.ts';

describe('prepareReleaseTargets for a monorepo', () => {
  beforeEach(() => {
    applyPrepareReleaseTargetsMonorepoDefaults();
  });

  afterEach(() => {
    resetPrepareReleaseTargetsMonorepoMocks();
  });

  describe('project block wiring', () => {
    it('does not run any project-related code when config.project is undefined', () => {
      const config = makeConfig({
        workspaces: [
          {
            dir: 'arrays',
            name: '@test/arrays',
            tagPrefix: 'arrays-v',
            workspacePath: 'packages/arrays',
            isPublishable: true,
            packageFiles: ['packages/arrays/package.json'],
            paths: ['packages/arrays/**'],
          },
        ],
      });
      stubHistory({ previousTag: 'arrays-v1.0.0', commits: [['feat: add', 'abc']], bump: 'minor' });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      const result = prepareMonorepo(config, {});

      expect(selectCompositeResult(result)).toBeUndefined();
      // The arrays workspace was bumped; the result doesn't contain a project tag.
      expect(result.tags).toStrictEqual(['arrays-v1.1.0']);
    });

    it('runs the project release when config.project is defined and returns it on selectCompositeResult(result)', () => {
      const config = makeConfig({
        workspaces: [
          {
            dir: 'arrays',
            name: '@test/arrays',
            tagPrefix: 'arrays-v',
            workspacePath: 'packages/arrays',
            isPublishable: true,
            packageFiles: ['packages/arrays/package.json'],
            paths: ['packages/arrays/**'],
          },
        ],
        project: { paths: ['packages/arrays/**'], tagPrefix: 'v' },
      });
      stubHistoryByPrefix({
        'arrays-v': { previousTag: 'arrays-v1.0.0', commits: [['feat: ship', 'abc123']], bump: 'minor' },
        v: { previousTag: 'v0.9.0', commits: [['feat: ship', 'abc123']], bump: 'minor' },
      });
      mockReadFileSync.mockImplementation((filePath: string) => {
        if (filePath === './package.json') return JSON.stringify({ name: 'root', version: '0.9.0' });
        return JSON.stringify({ version: '1.0.0' });
      });

      const result = prepareMonorepo(config, {});

      expect(selectCompositeResult(result)).toBeDefined();
      const projectResult = selectCompositeResult(result);
      assert(projectResult?.status === 'released', 'expected released project');
      expect(projectResult.tag).toBe('v0.10.0');
      expect(projectResult.releaseType).toBe('minor');
      expect(result.tags).toContain('arrays-v1.1.0');
      expect(result.tags).toContain('v0.10.0');
      // The workspace and the project each read their history once.
      expect(listReadOptions()).toStrictEqual([
        { tagPrefixes: ['arrays-v'], paths: ['packages/arrays/**'], scope: 'arrays' },
        { tagPrefixes: ['v'], paths: ['packages/arrays/**'] },
      ]);
    });

    it('skips the project release and warns when the run is narrowed by --only', () => {
      const config = makeConfig({
        workspaces: [
          {
            dir: 'arrays',
            name: '@test/arrays',
            tagPrefix: 'arrays-v',
            workspacePath: 'packages/arrays',
            isPublishable: true,
            packageFiles: ['packages/arrays/package.json'],
            paths: ['packages/arrays/**'],
          },
        ],
        project: { paths: ['packages/arrays/**'], tagPrefix: 'v' },
      });
      stubHistoryByPrefix({
        'arrays-v': { previousTag: 'arrays-v1.0.0', commits: [['feat: ship', 'abc123']], bump: 'minor' },
        v: { previousTag: 'v0.9.0', commits: [['feat: ship', 'abc123']], bump: 'minor' },
      });
      mockReadFileSync.mockImplementation((filePath: string) => {
        if (filePath === './package.json') return JSON.stringify({ name: 'root', version: '0.9.0' });
        return JSON.stringify({ version: '1.0.0' });
      });

      const result = prepareMonorepo(config, { onlyTargetIds: ['arrays'] });

      expect(selectCompositeResult(result)).toBeUndefined();
      expect(result.tags).toContain('arrays-v1.1.0');
      expect(result.tags).not.toContain('v0.10.0');
      expect(result.warnings?.join('\n')).toContain('Project release skipped');
      expect(result.warnings?.join('\n')).toContain('arrays');
      expect(listReadOptions()).toStrictEqual([
        { tagPrefixes: ['arrays-v'], paths: ['packages/arrays/**'], scope: 'arrays' },
      ]);
    });

    describe('a named composite under --only', () => {
      /** Prepares one workspace and a composite named `suite` over it, both with a minor bump pending. */
      function prepareNamed(onlyTargetIds: string[]): ReturnType<typeof prepareMonorepo> {
        const config = makeConfig({
          workspaces: [
            {
              dir: 'arrays',
              name: '@test/arrays',
              tagPrefix: 'arrays-v',
              workspacePath: 'packages/arrays',
              isPublishable: true,
              packageFiles: ['packages/arrays/package.json'],
              paths: ['packages/arrays/**'],
            },
          ],
          project: { paths: ['packages/arrays/**'], tagPrefix: 'v', name: 'suite', members: ['arrays'] },
        });
        stubHistoryByPrefix({
          'arrays-v': { previousTag: 'arrays-v1.0.0', commits: [['feat: ship', 'abc123']], bump: 'minor' },
          v: { previousTag: 'v0.9.0', commits: [['feat: ship', 'abc123']], bump: 'minor' },
        });
        mockReadFileSync.mockImplementation((filePath: string) => {
          if (filePath === './package.json') return JSON.stringify({ name: 'root', version: '0.9.0' });
          return JSON.stringify({ version: '1.0.0' });
        });
        return prepareMonorepo(config, { onlyTargetIds });
      }

      it('prepares the composite alone from its own window when --only names only it', () => {
        const result = prepareNamed(['suite']);

        expect(result.tags).toStrictEqual(['v0.10.0']);
        expect(listReadOptions()).toStrictEqual([{ tagPrefixes: ['v'], paths: ['packages/arrays/**'] }]);
      });

      it('prepares named packages and the named composite together', () => {
        const result = prepareNamed(['arrays', 'suite']);

        expect(result.tags).toStrictEqual(['arrays-v1.1.0', 'v0.10.0']);
      });

      it('skips the composite with a warning that names it when --only leaves it out', () => {
        const result = prepareNamed(['arrays']);

        expect(result.tags).toStrictEqual(['arrays-v1.1.0']);
        expect(result.warnings).toContain(
          "Release 'suite' skipped: --only does not name it. Add suite to --only to include it.",
        );
      });
    });

    it('passes project files to the format command alongside per-workspace files', () => {
      const config = makeConfig({
        formatCommand: 'npx prettier --write',
        workspaces: [
          {
            dir: 'arrays',
            name: '@test/arrays',
            tagPrefix: 'arrays-v',
            workspacePath: 'packages/arrays',
            isPublishable: true,
            packageFiles: ['packages/arrays/package.json'],
            paths: ['packages/arrays/**'],
          },
        ],
        project: { paths: ['packages/arrays/**'], tagPrefix: 'v' },
      });
      stubHistoryByPrefix({
        'arrays-v': { previousTag: 'arrays-v1.0.0', commits: [['feat: ship', 'abc123']], bump: 'minor' },
        v: { previousTag: 'v0.9.0', commits: [['feat: ship', 'abc123']], bump: 'minor' },
      });
      mockReadFileSync.mockImplementation((filePath: string) => {
        if (filePath === './package.json') return JSON.stringify({ name: 'root', version: '0.9.0' });
        return JSON.stringify({ version: '1.0.0' });
      });

      const result = prepareMonorepo(config, {});

      const formatCommandString = result.formatCommand?.command;
      expect(formatCommandString).toContain('packages/arrays/package.json');
      expect(formatCommandString).toContain('./package.json');
      expect(formatCommandString).toContain('CHANGELOG.md');
    });
  });

  describe('--with-release-notes flag', () => {
    function setupArraysWithFeat(): MonorepoReleaseConfig {
      const config = makeConfig({
        workspaces: [
          {
            dir: 'arrays',
            name: '@test/arrays',
            tagPrefix: 'arrays-v',
            workspacePath: 'packages/arrays',
            isPublishable: true,
            packageFiles: ['packages/arrays/package.json'],
            paths: ['packages/arrays/**'],
          },
        ],
        changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true },
      });
      stubHistory({ previousTag: 'arrays-v1.0.0', commits: [['feat: add utility', 'abc123']], bump: 'minor' });
      mockExecFileSync.mockReturnValue('[]');
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));
      return config;
    }

    it('invokes planReleaseNotesPreviews for each released workspace when enabled', () => {
      const config = setupArraysWithFeat();

      prepareMonorepo(config, { shouldIncludeReleaseNotes: true });

      expect(mockPlanReleaseNotesPreviews).toHaveBeenCalledTimes(1);
      expect(mockPlanReleaseNotesPreviews).toHaveBeenCalledWith(
        expect.objectContaining({
          workspacePath: 'packages/arrays',
          tag: 'arrays-v1.1.0',
          entries: expect.any(Array),
          sectionOrder: expect.any(Array),
        }),
      );
    });

    it('does not invoke planReleaseNotesPreviews when the flag is not set', () => {
      const config = setupArraysWithFeat();

      prepareMonorepo(config, {});

      expect(mockPlanReleaseNotesPreviews).not.toHaveBeenCalled();
    });

    it('records a warning and skips when --with-release-notes is set but changelogJson.enabled is false', () => {
      const config = makeConfig({
        workspaces: [
          {
            dir: 'arrays',
            name: '@test/arrays',
            tagPrefix: 'arrays-v',
            workspacePath: 'packages/arrays',
            isPublishable: true,
            packageFiles: ['packages/arrays/package.json'],
            paths: ['packages/arrays/**'],
          },
        ],
      });
      stubHistory({ previousTag: 'arrays-v1.0.0', commits: [['feat: add utility', 'abc123']], bump: 'minor' });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));
      using silencedConsole = silenceConsole(['warn']);

      const plan = prepareMonorepo(config, { shouldIncludeReleaseNotes: true });

      expect(mockPlanReleaseNotesPreviews).not.toHaveBeenCalled();
      expect(plan.warnings).toStrictEqual([
        '--with-release-notes requires changelogJson.enabled; skipping preview generation',
      ]);
      expect(silencedConsole.warn).not.toHaveBeenCalled();
    });

    it('does not invoke previews for skipped workspaces', () => {
      const config = makeConfig({
        workspaces: [
          {
            dir: 'arrays',
            name: '@test/arrays',
            tagPrefix: 'arrays-v',
            workspacePath: 'packages/arrays',
            isPublishable: true,
            packageFiles: ['packages/arrays/package.json'],
            paths: ['packages/arrays/**'],
          },
        ],
        changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true },
      });
      stubHistory({ previousTag: 'arrays-v1.0.0' });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/arrays', version: '1.0.0' }));

      prepareMonorepo(config, { shouldIncludeReleaseNotes: true });

      expect(mockPlanReleaseNotesPreviews).not.toHaveBeenCalled();
    });

    it('includes the planned preview files in the plan', () => {
      const config = setupArraysWithFeat();

      mockPlanReleaseNotesPreviews.mockReturnValue({
        writes: [{ path: 'packages/arrays/docs/RELEASE_NOTES.v1.1.0.md', content: '# Notes\n' }],
        warnings: [],
      });

      const plan = prepareMonorepo(config, { shouldIncludeReleaseNotes: true });

      expect(findPlannedContent(plan, 'packages/arrays/docs/RELEASE_NOTES.v1.1.0.md')).toBe('# Notes\n');
      expect(selectPackageResults(plan)[0]).toMatchObject({
        previewFiles: ['packages/arrays/docs/RELEASE_NOTES.v1.1.0.md'],
      });
    });

    it('invokes planReleaseNotesPreviews for both direct-bumped and propagation-only workspaces', () => {
      // Mirrors the `dependency propagation` setup: core is bumped directly (feat commit), and
      // app is bumped only through propagation. Both branches of `generateWorkspaceChangelogs`
      // must reach `maybeWritePreviews` so that previews are written for each workspace.
      const config = stubPropagationWorkspaces({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } });

      stubHistoryByPrefix({
        'core-v': { previousTag: 'core-v1.0.0', commits: [['feat: add utility', 'abc123']], bump: 'minor' },
        'app-v': { previousTag: 'app-v2.0.0' },
      });
      mockExecFileSync.mockReturnValue('[]');

      prepareMonorepo(config, { shouldIncludeReleaseNotes: true });

      expect(mockPlanReleaseNotesPreviews).toHaveBeenCalledTimes(2);
      // Confirm each workspace received a preview call with the correct workspacePath and tag.
      expect(mockPlanReleaseNotesPreviews).toHaveBeenCalledWith(
        expect.objectContaining({ workspacePath: 'packages/core', tag: 'core-v1.1.0' }),
      );
      expect(mockPlanReleaseNotesPreviews).toHaveBeenCalledWith(
        expect.objectContaining({ workspacePath: 'packages/app', tag: 'app-v2.0.1' }),
      );
    });
  });

  describe('stage attribution', () => {
    function makeArraysConfig(overrides?: Partial<MonorepoReleaseConfig>): MonorepoReleaseConfig {
      return makeConfig({
        workspaces: [
          {
            dir: 'arrays',
            name: '@test/arrays',
            tagPrefix: 'arrays-v',
            workspacePath: 'packages/arrays',
            isPublishable: true,
            packageFiles: ['packages/arrays/package.json'],
            paths: ['packages/arrays/**'],
          },
        ],
        ...overrides,
      });
    }

    it("wraps a Phase 1 (history-read) throw with the workspace's release-stage label", async () => {
      const config = makeArraysConfig();
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/arrays', version: '1.0.0' }));
      // Make `readReleaseHistory` throw, which exercises the Phase 1 wrap inside `determineDirectBumps`.
      const underlyingError = new Error('git rev-list failed: not a git repo');
      mockReadReleaseHistory.mockImplementation(() => {
        throw underlyingError;
      });

      const wrappedError = await captureError(() => prepareMonorepo(config, {}));

      expect(wrappedError.message).toMatch(/^workspace 'arrays' release stage: .*git rev-list failed: not a git repo$/);
      // `cause` is preserved through the chain: at minimum, an Error instance.
      expect(wrappedError.cause).toBeInstanceOf(Error);
    });

    it("wraps a Phase 3 (executeWorkspaceRelease) throw with the workspace's release-stage label", async () => {
      const config = makeArraysConfig();
      // Phase 1 succeeds. `renderChangelogMarkdown` (which `executeWorkspaceRelease` reaches)
      // throws, which exercises the Phase 3 wrap inside `executeReleaseSet`.
      const underlyingError = new Error('markdown render failed');
      stubHistory({ previousTag: 'arrays-v1.0.0', commits: [['feat: add', 'abc123']], bump: 'minor' });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));
      mockRenderChangelogMarkdown.mockImplementationOnce(() => {
        throw underlyingError;
      });

      const wrappedError = await captureError(() => prepareMonorepo(config, {}));

      expect(wrappedError.message).toMatch(/^workspace 'arrays' release stage: .*markdown render failed$/);
      // `cause` is preserved through the chain: at minimum, an Error instance.
      expect(wrappedError.cause).toBeInstanceOf(Error);
    });

    it('wraps a project-stage throw with the project release-stage label', async () => {
      const config = makeArraysConfig({ project: { paths: ['packages/arrays/**'], tagPrefix: 'v' } });
      // The workspace stage's read succeeds; the project stage's read throws.
      const underlyingError = new Error('git log failed on root');
      mockReadFileSync.mockImplementation((filePath: string) => {
        if (filePath === './package.json') return JSON.stringify({ name: 'root', version: '0.9.0' });
        return JSON.stringify({ version: '1.0.0' });
      });
      mockReadReleaseHistory
        .mockReturnValueOnce(
          makeReleaseHistory({ previousTag: 'arrays-v1.0.0', commits: [['feat: ship', 'abc123']], bump: 'minor' }),
        )
        .mockImplementationOnce(() => {
          throw underlyingError;
        });

      const wrappedError = await captureError(() => prepareMonorepo(config, {}));

      expect(wrappedError.message).toMatch(/^project release stage: .*git log failed on root$/);
      expect(wrappedError.cause).toBeInstanceOf(Error);
    });
  });
});
