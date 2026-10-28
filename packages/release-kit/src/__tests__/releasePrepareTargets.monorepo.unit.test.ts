import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  applyReleasePrepareTargetsMonorepoDefaults,
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

import { selectPackageResults } from '../test-utils/prepareResults.ts';
import { makeConfig, plannedContent, prepareMonorepo } from '../test-utils/releasePrepareTargetsMonorepoFixtures.ts';

describe('releasePrepareTargets for a monorepo', () => {
  beforeEach(() => {
    applyReleasePrepareTargetsMonorepoDefaults();
  });

  afterEach(() => {
    resetReleasePrepareTargetsMonorepoMocks();
  });

  it('processes a workspace that has commits', () => {
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

    const result = prepareMonorepo(config, {});

    expect(result.tags).toStrictEqual(['arrays-v1.1.0']);
    expect(selectPackageResults(result)).toHaveLength(1);
    expect(selectPackageResults(result)[0]).toMatchObject({
      name: 'arrays',
      status: 'released',
      tag: 'arrays-v1.1.0',
      currentVersion: '1.0.0',
      newVersion: '1.1.0',
      changelogFiles: ['packages/arrays/CHANGELOG.md'],
    });

    expect(plannedContent(result, 'packages/arrays/package.json')).toContain('"version": "1.1.0"');
    expect(mockWriteFileSync).not.toHaveBeenCalled();

    // Verify the history was read once, under the workspace's own tag prefixes and paths
    expect(listReadOptions()).toStrictEqual([
      { tagPrefixes: ['arrays-v'], paths: ['packages/arrays/**'], scope: 'arrays' },
    ]);
    expect(result.writes.map((write) => write.path)).toContain('packages/arrays/CHANGELOG.md');
  });

  it('skips a workspace without any commits', () => {
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

    stubHistory({ previousTag: 'arrays-v1.0.0' });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/arrays', version: '1.0.0' }));

    const result = prepareMonorepo(config, {});

    expect(result.tags).toStrictEqual([]);
    expect(selectPackageResults(result)).toHaveLength(1);
    expect(selectPackageResults(result)[0]).toMatchObject({
      name: 'arrays',
      status: 'skipped',
      commitCount: 0,
      parsedCommitCount: 0,
      previousTag: 'arrays-v1.0.0',
    });
    const [workspaceResult] = selectPackageResults(result);
    assert(workspaceResult?.status === 'skipped', 'expected skipped');
    expect(workspaceResult.skipReason).toContain('No commits for arrays since arrays-v1.0.0');
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(result.writes).toStrictEqual([]);
    expect(listReadOptions()).toStrictEqual([
      { tagPrefixes: ['arrays-v'], paths: ['packages/arrays/**'], scope: 'arrays' },
    ]);
  });

  it("skips a workspace without any commits whose package.json doesn't declare a version", () => {
    const config = makeConfig({
      workspaces: [
        {
          dir: 'arrays',
          name: '@test/arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
          isPublishable: false,
          packageFiles: ['packages/arrays/package.json'],
          paths: ['packages/arrays/**'],
        },
      ],
    });

    stubHistory({ previousTag: 'arrays-v1.0.0' });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/arrays', private: true }));

    const result = prepareMonorepo(config, {});

    expect(result.tags).toStrictEqual([]);
    expect(selectPackageResults(result)).toStrictEqual([
      expect.objectContaining({ name: 'arrays', status: 'skipped' }),
    ]);
  });

  it('processes only workspaces with commits when multiple are configured', () => {
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
        {
          dir: 'strings',
          name: '@test/strings',
          tagPrefix: 'strings-v',
          workspacePath: 'packages/strings',
          isPublishable: true,
          packageFiles: ['packages/strings/package.json'],
          paths: ['packages/strings/**'],
        },
      ],
    });

    stubHistoryByPrefix({
      'arrays-v': { previousTag: 'arrays-v1.0.0', commits: [['fix: fix array bug', 'def456']], bump: 'patch' },
      'strings-v': { previousTag: 'strings-v2.0.0' },
    });

    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = prepareMonorepo(config, {});

    expect(result.tags).toStrictEqual(['arrays-v1.0.1']);
    expect(selectPackageResults(result)).toHaveLength(2);
    expect(selectPackageResults(result)[0]).toMatchObject({ name: 'arrays', status: 'released' });
    expect(selectPackageResults(result)[1]).toMatchObject({ name: 'strings', status: 'skipped' });

    expect(result.writes.map((write) => write.path)).toContain('packages/arrays/package.json');
    expect(result.writes.map((write) => write.path)).not.toContain('packages/strings/package.json');

    expect(result.writes.map((write) => write.path)).toContain('packages/arrays/CHANGELOG.md');
    expect(result.writes.map((write) => write.path)).not.toContain('packages/strings/CHANGELOG.md');

    // Each workspace's history is read once, the skipped one included
    expect(listReadOptions()).toStrictEqual([
      { tagPrefixes: ['arrays-v'], paths: ['packages/arrays/**'], scope: 'arrays' },
      { tagPrefixes: ['strings-v'], paths: ['packages/strings/**'], scope: 'strings' },
    ]);
  });

  it('plans files and the format command without performing either', () => {
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
    });

    stubHistory({ previousTag: 'arrays-v1.0.0', commits: [['feat: add feature', 'abc123']], bump: 'minor' });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = prepareMonorepo(config, {});

    expect(result.tags).toStrictEqual(['arrays-v1.1.0']);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(mockExecSync).not.toHaveBeenCalled();

    expect(result.writes.map((write) => write.path)).toStrictEqual([
      'packages/arrays/package.json',
      'packages/arrays/CHANGELOG.md',
    ]);
    expect(result.formatCommand).toMatchObject({
      command: 'npx prettier --write packages/arrays/package.json packages/arrays/CHANGELOG.md',
    });
  });

  it('renders one formatCommand covering every processed workspace', () => {
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
        {
          dir: 'strings',
          name: '@test/strings',
          tagPrefix: 'strings-v',
          workspacePath: 'packages/strings',
          isPublishable: true,
          packageFiles: ['packages/strings/package.json'],
          paths: ['packages/strings/**'],
        },
      ],
    });

    stubHistoryByPrefix({
      'arrays-v': { previousTag: 'arrays-v1.0.0', commits: [['feat: add feature', 'abc123']], bump: 'minor' },
      'strings-v': { previousTag: 'strings-v1.0.0', commits: [['feat: add feature', 'abc123']], bump: 'minor' },
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = prepareMonorepo(config, {});

    expect(mockExecSync).not.toHaveBeenCalled();
    expect(result.formatCommand?.command).toBe(
      'npx prettier --write packages/arrays/package.json packages/arrays/CHANGELOG.md packages/strings/package.json packages/strings/CHANGELOG.md',
    );
  });

  it("does not run formatCommand when the workspaces don't have any commits", () => {
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
    });

    stubHistory({ previousTag: 'arrays-v1.0.0' });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/arrays', version: '1.0.0' }));

    const result = prepareMonorepo(config, {});

    expect(result.tags).toStrictEqual([]);
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it("defaults to prettier when the config doesn't set formatCommand and a prettier config exists", () => {
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
    mockHasPrettierConfig.mockReturnValue(true);

    stubHistory({ previousTag: 'arrays-v1.0.0', commits: [['feat: add feature', 'abc123']], bump: 'minor' });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = prepareMonorepo(config, {});

    expect(result.formatCommand?.command).toBe(
      'npx prettier --write packages/arrays/package.json packages/arrays/CHANGELOG.md',
    );
  });

  it("skips formatting when the config doesn't set formatCommand and the repo doesn't have a prettier config", () => {
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
    mockHasPrettierConfig.mockReturnValue(false);

    stubHistory({ previousTag: 'arrays-v1.0.0', commits: [['feat: add feature', 'abc123']], bump: 'minor' });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    prepareMonorepo(config, {});

    expect(mockExecSync).not.toHaveBeenCalled();
  });
});
