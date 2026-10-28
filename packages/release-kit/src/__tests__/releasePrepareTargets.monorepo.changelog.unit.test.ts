import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  applyReleasePrepareTargetsMonorepoDefaults,
  FORCED_BUMP_ENTRY,
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
  resetReleasePrepareTargetsMonorepoMocks,
  stubFiles,
  stubHistory,
  stubHistoryByPrefix,
} = await vi.hoisted(() => import('../test-utils/releasePrepareTargetsMonorepoMocks.ts'));

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
// deterministic values without reading git history or touching the filesystem; `toChangelogEntries`
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
import { selectPackageResults } from '../test-utils/prepareResults.ts';
import {
  makeConfig,
  makeRoutedWorkspace,
  prepareMonorepo,
  RELEASED_ENTRY,
  stubPropagationWorkspaces,
} from '../test-utils/releasePrepareTargetsMonorepoFixtures.ts';
import type { ChangelogSection, MonorepoReleaseConfig, WorkspaceConfig } from '../types.ts';

describe('releasePrepareTargets for a monorepo', () => {
  beforeEach(() => {
    applyReleasePrepareTargetsMonorepoDefaults();
  });

  afterEach(() => {
    resetReleasePrepareTargetsMonorepoMocks();
  });

  describe("releases whose window doesn't yield an item", () => {
    // When a workspace is forced to release (`--force` or `--set-version`) although
    // its unreleased window doesn't yield a changelog item, a synthetic
    // "Notes / Forced version bump." entry stands in for that window.

    /** Builds a config whose one workspace is `arrays`. */
    function singleWorkspaceConfig(overrides?: Partial<MonorepoReleaseConfig>): MonorepoReleaseConfig {
      const workspace: WorkspaceConfig = {
        dir: 'arrays',
        name: '@test/arrays',
        tagPrefix: 'arrays-v',
        workspacePath: 'packages/arrays',
        isPublishable: true,
        packageFiles: ['packages/arrays/package.json'],
        paths: ['packages/arrays/**'],
      };
      return makeConfig({ workspaces: [workspace], ...overrides });
    }

    /** Stubs a history whose baseline tag doesn't have any commits after it. */
    function stubEmptyRange(): void {
      stubHistory({ previousTag: 'arrays-v1.0.0' });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/arrays', version: '1.0.0' }));
      mockExistsSync.mockReturnValue(false);
    }

    it('writes a synthetic Notes / Forced version bump entry when --force is used without any commits', () => {
      stubEmptyRange();

      const result = prepareMonorepo(singleWorkspaceConfig(), { shouldForce: true });

      expect(result.tags).toStrictEqual(['arrays-v1.0.1']);

      // The empty-range branch builds a synthetic Notes entry (mocked) and passes it to
      // the markdown renderer; assert on the renderer's args.
      expect(mockBuildEmptyReleaseEntry).toHaveBeenCalledWith('1.0.1', expect.any(String));
      expect(result.writes.map((write) => write.path)).toContain('packages/arrays/CHANGELOG.md');
    });

    it.each([
      ['--force', { shouldForce: true }, '1.0.1'],
      ['--set-version', { versionOverridesById: new Map([['arrays', '2.0.0']]) }, '2.0.0'],
    ])(
      "writes the synthetic entry under %s when the window has commits but doesn't yield an item",
      (_label, options, version) => {
        stubEmptyRange();
        stubHistory({
          previousTag: 'arrays-v1.0.0',
          commits: [
            ['fmt: reformat', 'abc123'],
            ['update readme', 'def456'],
          ],
        });

        const result = prepareMonorepo(singleWorkspaceConfig(), options);

        expect(result.tags).toStrictEqual([`arrays-v${version}`]);
        expect(mockBuildEmptyReleaseEntry).toHaveBeenCalledExactlyOnceWith(version, expect.any(String));
        expect(mockMergeChangelogEntriesWithDisk).toHaveBeenCalledExactlyOnceWith(expect.any(String), [
          FORCED_BUMP_ENTRY,
        ]);
      },
    );

    it("puts the synthetic entry ahead of the workspace's released entries", () => {
      stubEmptyRange();
      stubHistory({ previousTag: 'arrays-v1.0.0', releasedEntries: [RELEASED_ENTRY] });

      const result = prepareMonorepo(singleWorkspaceConfig(), { shouldForce: true, bumpOverride: 'minor' });

      expect(result.tags).toStrictEqual(['arrays-v1.1.0']);
      expect(mockBuildEmptyReleaseEntry).toHaveBeenCalledExactlyOnceWith('1.1.0', expect.any(String));
      expect(mockMergeChangelogEntriesWithDisk).toHaveBeenCalledExactlyOnceWith(expect.any(String), [
        FORCED_BUMP_ENTRY,
        RELEASED_ENTRY,
      ]);
      expect(mockReadReleaseHistory).toHaveBeenCalledTimes(1);
    });

    it('skips an empty-range workspace when --bump=X is set without --force', () => {
      stubEmptyRange();

      const result = prepareMonorepo(singleWorkspaceConfig(), { bumpOverride: 'minor' });

      expect(result.tags).toStrictEqual([]);
      expect(selectPackageResults(result)[0]).toMatchObject({ status: 'skipped', commitCount: 0 });
      expect(mockBuildEmptyReleaseEntry).not.toHaveBeenCalled();
    });

    it('upserts a synthetic empty-range entry into changelog.json when enabled', () => {
      stubEmptyRange();

      prepareMonorepo(singleWorkspaceConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }), {
        shouldForce: true,
      });

      expect(mockBuildEmptyReleaseEntry).toHaveBeenCalledTimes(1);
      expect(mockBuildEmptyReleaseEntry).toHaveBeenCalledWith('1.0.1', expect.any(String));
      expect(mockReadReleaseHistory).toHaveBeenCalledTimes(1);
      expect(mockRenderChangelogJson).toHaveBeenCalledTimes(1);
    });

    it('keeps propagation-only workspaces on the propagation path (no regression)', () => {
      const config = stubPropagationWorkspaces();

      stubHistoryByPrefix({
        'core-v': {
          previousTag: 'core-v1.0.0',
          commits: [['fix: bug fix', 'abc123']],
          bump: 'patch',
          sections: [{ title: 'Bug fixes', audience: 'all', items: [{ description: 'Bug fix', hash: 'abc123' }] }],
        },
        'app-v': { previousTag: 'app-v2.0.0' },
      });
      prepareMonorepo(config, {});

      // The propagation-only path constructs a synthetic propagation entry, not an empty-range
      // entry. Both constructors are mocked, so observe the call counts.
      expect(mockBuildSyntheticChangelogEntry).toHaveBeenCalledTimes(1);
      // Because core takes the release-window path and app the propagation path, the workspaces
      // don't build an empty-range entry.
      expect(mockBuildEmptyReleaseEntry).not.toHaveBeenCalled();
    });

    it('keeps workspaces with real commits on the release-window path (no regression)', () => {
      const config = singleWorkspaceConfig();
      const sections: ChangelogSection[] = [
        { title: 'Features', audience: 'all', items: [{ description: 'New utility', hash: 'abc123' }] },
      ];
      stubHistory({
        previousTag: 'arrays-v1.0.0',
        commits: [['feat: new utility', 'abc123']],
        bump: 'minor',
        sections,
        releasedEntries: [RELEASED_ENTRY],
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/arrays', version: '1.0.0' }));

      prepareMonorepo(config, {});

      // Real commits → the unreleased window, labeled with the new tag, leads the released windows.
      expect(mockBuildEmptyReleaseEntry).not.toHaveBeenCalled();
      expect(mockMergeChangelogEntriesWithDisk).toHaveBeenCalledExactlyOnceWith(expect.any(String), [
        { version: '1.1.0', date: '2024-01-01', sections },
        RELEASED_ENTRY,
      ]);
    });

    it('does not write synthetic entries for workspaces correctly skipped (no commits, no --force)', () => {
      stubEmptyRange();

      const result = prepareMonorepo(singleWorkspaceConfig(), {});

      expect(result.tags).toStrictEqual([]);
      expect(selectPackageResults(result)[0]).toMatchObject({ status: 'skipped' });
      expect(mockBuildEmptyReleaseEntry).not.toHaveBeenCalled();
      // No CHANGELOG.md write for the skipped workspace.
      const changelogWrites = mockWriteFileSync.mock.calls.filter(
        (call: unknown[]) => call[0] === 'packages/arrays/CHANGELOG.md',
      );
      expect(changelogWrites).toHaveLength(0);
    });

    it('returns the tag and changelog path without writing either', () => {
      stubEmptyRange();

      const result = prepareMonorepo(
        singleWorkspaceConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }),
        { shouldForce: true },
      );

      expect(result.tags).toStrictEqual(['arrays-v1.0.1']);
      const workspaceResult = selectPackageResults(result)[0];
      assert(workspaceResult?.status === 'released', 'expected released');
      expect(workspaceResult.changelogFiles).toStrictEqual(['packages/arrays/CHANGELOG.md']);

      const changelogWrites = mockWriteFileSync.mock.calls.filter(
        (call: unknown[]) => call[0] === 'packages/arrays/CHANGELOG.md',
      );
      expect(changelogWrites).toHaveLength(0);
    });

    it('reads each history once and builds every empty-range changelog from the synthetic entry in a multi-workspace --force run', () => {
      const config = makeConfig({
        changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true },
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
          {
            dir: 'strings',
            name: '@test/strings',
            tagPrefix: 'strings-v',
            workspacePath: 'packages/strings',
            isPublishable: true,
            packageFiles: ['packages/strings/package.json'],
            paths: ['packages/strings/**'],
          },
          {
            dir: 'numbers',
            name: '@test/numbers',
            tagPrefix: 'numbers-v',
            workspacePath: 'packages/numbers',
            isPublishable: true,
            packageFiles: ['packages/numbers/package.json'],
            paths: ['packages/numbers/**'],
          },
        ],
      });

      stubHistoryByPrefix({
        'arrays-v': { previousTag: 'arrays-v1.0.0' },
        'strings-v': { previousTag: 'strings-v1.0.0' },
        'numbers-v': { previousTag: 'numbers-v1.0.0' },
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));
      mockExistsSync.mockReturnValue(false);

      prepareMonorepo(config, { shouldForce: true });

      // Three workspaces, all empty-range, all forced: each reads its history once, and each changelog
      // comes from the synthetic entry.
      expect(listReadOptions()).toStrictEqual([
        { tagPrefixes: ['arrays-v'], paths: ['packages/arrays/**'], scope: 'arrays' },
        { tagPrefixes: ['strings-v'], paths: ['packages/strings/**'], scope: 'strings' },
        { tagPrefixes: ['numbers-v'], paths: ['packages/numbers/**'], scope: 'numbers' },
      ]);
      expect(mockBuildEmptyReleaseEntry).toHaveBeenCalledTimes(3);
    });
  });

  describe('existing CHANGELOG.md sections', () => {
    it('keeps markdown-only sections for a direct release and a propagation-only one', () => {
      const config = stubPropagationWorkspaces(
        {},
        {
          'packages/core/CHANGELOG.md': '# Changelog\n\n## 1.0.0\n\n- Core one\n',
          'packages/app/CHANGELOG.md': '# Changelog\n\n## 2.0.0\n\n- App two\n',
        },
      );
      stubHistoryByPrefix({
        'core-v': { previousTag: 'core-v1.0.0', commits: [['feat: add utility', 'abc123']], bump: 'minor' },
        'app-v': { previousTag: 'app-v2.0.0' },
      });

      const result = prepareMonorepo(config, {});

      expect(mockRenderChangelogMarkdown).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ preservedSections: [{ version: '1.0.0', text: '## 1.0.0\n\n- Core one' }] }),
      );
      expect(mockRenderChangelogMarkdown).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ preservedSections: [{ version: '2.0.0', text: '## 2.0.0\n\n- App two' }] }),
      );
      expect(selectPackageResults(result).find((workspace) => workspace.name === 'app')).toMatchObject({
        propagatedOnly: true,
        changelogPreservation: [
          { file: 'packages/app/CHANGELOG.md', preservedVersions: ['2.0.0'], droppedUnversionedHeadings: [] },
        ],
      });
    });

    it('renders a version from the entries when the history also yields it', () => {
      const config = makeConfig({ workspaces: [makeRoutedWorkspace('core')] });
      stubHistory({
        previousTag: 'core-v1.0.0',
        commits: [['feat: add utility', 'abc123']],
        bump: 'minor',
        releasedEntries: [RELEASED_ENTRY],
      });
      stubFiles({
        'packages/core/package.json': JSON.stringify({ version: '1.0.0' }),
        'packages/core/CHANGELOG.md': '## 1.0.0\n\n- Stale\n',
      });

      const result = prepareMonorepo(config, {});

      expect(mockRenderChangelogMarkdown).toHaveBeenCalledExactlyOnceWith(
        [FORCED_BUMP_ENTRY, RELEASED_ENTRY],
        expect.objectContaining({ preservedSections: [] }),
      );
      expect(selectPackageResults(result)[0]).not.toHaveProperty('changelogPreservation');
    });

    it('records what it kept and dropped from the changelog', () => {
      stubHistory({ previousTag: 'core-v1.0.0', commits: [['feat: add utility', 'abc123']], bump: 'minor' });
      stubFiles({
        'packages/core/package.json': JSON.stringify({ version: '1.0.0' }),
        'packages/core/CHANGELOG.md': '## 0.9.0\n\n- Old\n\n## Notes\n\n- Prose\n',
      });

      const result = prepareMonorepo(makeConfig({ workspaces: [makeRoutedWorkspace('core')] }), {});

      expect(selectPackageResults(result)[0]).toMatchObject({
        changelogPreservation: [
          {
            file: 'packages/core/CHANGELOG.md',
            preservedVersions: ['0.9.0'],
            droppedUnversionedHeadings: ['## Notes'],
          },
        ],
      });
    });
  });

  describe('untagged baseline', () => {
    /** Stubs `core` and `app` at versions that their changelogs record, above tags of earlier versions. */
    function stubUntaggedWorkspaces(): MonorepoReleaseConfig {
      stubHistoryByPrefix({
        'core-v': { previousTag: 'core-v1.0.0', commits: [['feat: add utility', 'abc123']], bump: 'minor' },
        'app-v': { previousTag: 'app-v2.0.0' },
      });
      stubFiles({
        'packages/core/package.json': JSON.stringify({ version: '1.1.0' }),
        'packages/core/CHANGELOG.md': '## 1.1.0\n',
        'packages/app/package.json': JSON.stringify({ version: '2.1.0' }),
        'packages/app/.meta/changelog.json': JSON.stringify([{ version: '2.1.0', date: '2024-01-01', sections: [] }]),
      });
      return makeConfig({ workspaces: [makeRoutedWorkspace('core'), makeRoutedWorkspace('app')] });
    }

    it('names every untagged workspace in one error not wrapped by a stage label', () => {
      const config = stubUntaggedWorkspaces();

      expect(() => prepareMonorepo(config, {})).toThrow(
        /^The current version is recorded in the changelog[^\n]*\n {2}- workspace 'core': 1\.1\.0 \(create tag core-v1\.1\.0\)\n {2}- workspace 'app': 2\.1\.0 \(create tag app-v2\.1\.0\)\n/,
      );
    });

    it('throws under --force', () => {
      const config = stubUntaggedWorkspaces();

      expect(() => prepareMonorepo(config, { shouldForce: true })).toThrow('create tag core-v1.1.0');
    });

    it('throws under --set-version', () => {
      const config = stubUntaggedWorkspaces();

      expect(() =>
        prepareMonorepo(
          { ...config, workspaces: [makeRoutedWorkspace('core')] },
          { versionOverridesById: new Map([['core', '3.0.0']]) },
        ),
      ).toThrow('create tag core-v1.1.0');
    });

    it('accepts a baseline tagged under a legacy prefix', () => {
      stubHistory({ previousTag: 'old-core-v1.1.0', commits: [['feat: add utility', 'abc123']], bump: 'minor' });
      stubFiles({
        'packages/core/package.json': JSON.stringify({ version: '1.1.0' }),
        'packages/core/CHANGELOG.md': '## 1.1.0\n',
      });
      const workspace: WorkspaceConfig = {
        ...makeRoutedWorkspace('core'),
        legacyIdentities: [{ name: '@old/core', tagPrefix: 'old-core-v' }],
      };

      expect(prepareMonorepo(makeConfig({ workspaces: [workspace] }), {}).tags).toStrictEqual(['core-v1.2.0']);
    });

    it('does not fire for a workspace that releases only through propagation', () => {
      stubPropagationFixture({ '@test/core': 'workspace:*' });

      const result = prepareMonorepo(
        makeConfig({ workspaces: [makeRoutedWorkspace('core'), makeRoutedWorkspace('app')] }),
        {},
      );

      expect(result.tags).toStrictEqual(['core-v1.1.0', 'app-v2.1.1']);
    });

    it('fires for a skipped workspace that nothing propagates to', () => {
      stubPropagationFixture({});

      expect(() =>
        prepareMonorepo(makeConfig({ workspaces: [makeRoutedWorkspace('core'), makeRoutedWorkspace('app')] }), {}),
      ).toThrow("workspace 'app': 2.1.0 (create tag app-v2.1.0)");
    });

    /** Stubs `core` releasing directly and `app` skipped above `app-v2.0.0` at a recorded version, with `dependencies`. */
    function stubPropagationFixture(dependencies: Record<string, string>): void {
      stubHistoryByPrefix({
        'core-v': { previousTag: 'core-v1.0.0', commits: [['feat: add utility', 'abc123']], bump: 'minor' },
        'app-v': { previousTag: 'app-v2.0.0' },
      });
      stubFiles({
        'packages/core/package.json': JSON.stringify({ name: '@test/core', version: '1.0.0' }),
        'packages/app/package.json': JSON.stringify({ name: '@test/app', version: '2.1.0', dependencies }),
        'packages/app/CHANGELOG.md': '## 2.1.0\n',
      });
    }
  });

  describe('changelogJson.enabled gating', () => {
    /** Builds a config whose one workspace is `arrays`. */
    function singleWorkspaceConfig(overrides?: Partial<MonorepoReleaseConfig>): MonorepoReleaseConfig {
      const workspace: WorkspaceConfig = {
        dir: 'arrays',
        name: '@test/arrays',
        tagPrefix: 'arrays-v',
        workspacePath: 'packages/arrays',
        isPublishable: true,
        packageFiles: ['packages/arrays/package.json'],
        paths: ['packages/arrays/**'],
      };
      return makeConfig({ workspaces: [workspace], ...overrides });
    }

    /** Stubs a history whose one commit since the prior tag calls for a minor bump. */
    function stubFeatCommit(): void {
      stubHistory({ previousTag: 'arrays-v1.0.0', commits: [['feat: add utility', 'abc123']], bump: 'minor' });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/arrays', version: '1.0.0' }));
      mockExistsSync.mockReturnValue(false);
    }

    it('does not plan a changelog.json write or format when changelogJson.enabled is false', () => {
      stubFeatCommit();

      const plan = prepareMonorepo(
        singleWorkspaceConfig({
          formatCommand: 'npx prettier --write',
          changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: false },
        }),
        {},
      );

      expect(mockMergeChangelogEntriesWithDisk).toHaveBeenCalledTimes(1);
      expect(plan.formatCommand).toBeDefined();
      expect(plan.formatCommand?.files).not.toContain('packages/arrays/.meta/changelog.json');
    });

    it('plans a changelog.json write and formats it when changelogJson.enabled is true', () => {
      stubFeatCommit();

      const plan = prepareMonorepo(
        singleWorkspaceConfig({
          formatCommand: 'npx prettier --write',
          changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true },
        }),
        {},
      );

      expect(mockRenderChangelogJson).toHaveBeenCalledTimes(1);
      expect(plan.writes.map((write) => write.path)).toContain('packages/arrays/.meta/changelog.json');
      expect(plan.formatCommand?.files).toContain('packages/arrays/.meta/changelog.json');
    });
  });
});
