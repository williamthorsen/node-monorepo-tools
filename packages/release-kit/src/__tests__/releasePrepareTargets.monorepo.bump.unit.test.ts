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

import { makeStubbedCommits } from '../test-utils/commitStubs.ts';
import { selectPackageResults } from '../test-utils/prepareResults.ts';
import {
  makeConfig,
  plannedContent,
  prepareMonorepo,
  RELEASED_ENTRY,
} from '../test-utils/releasePrepareTargetsMonorepoFixtures.ts';
import type { ChangelogSection } from '../types.ts';

describe('releasePrepareTargets for a monorepo', () => {
  beforeEach(() => {
    applyReleasePrepareTargetsMonorepoDefaults();
  });

  afterEach(() => {
    resetReleasePrepareTargetsMonorepoMocks();
  });

  it("prefers bumpOverride over the history's bump and labels the changelog with the overridden tag", () => {
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

    const sections: ChangelogSection[] = [
      { title: 'Bug fixes', audience: 'all', items: [{ description: 'Small patch', hash: 'abc123' }] },
    ];
    stubHistory({ previousTag: 'arrays-v1.0.0', commits: [['fix: small patch', 'abc123']], bump: 'patch', sections });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = prepareMonorepo(config, { bumpOverride: 'minor' });

    expect(result.tags).toStrictEqual(['arrays-v1.1.0']);

    // Should use the override (minor) rather than the history's bump (patch)
    expect(plannedContent(result, 'packages/arrays/package.json')).toContain('"version": "1.1.0"');
    expect(selectPackageResults(result)[0]).toMatchObject({ releaseType: 'minor', bumpOverride: 'minor' });

    expect(mockMergeChangelogEntriesWithDisk).toHaveBeenCalledExactlyOnceWith(expect.any(String), [
      { version: '1.1.0', date: '2024-01-01', sections },
    ]);
  });

  it("skips when the history's commits don't call for a bump and --force is not given", () => {
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

    stubHistory({
      previousTag: 'arrays-v1.0.0',
      commits: [['chore: update deps', 'abc123']],
      unparseableCommits: [['chore: update deps', 'abc123']],
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = prepareMonorepo(config, {});

    expect(result.tags).toStrictEqual([]);
    const workspace = selectPackageResults(result)[0];
    expect(workspace).toMatchObject({
      status: 'skipped',
      commitCount: 1,
      parsedCommitCount: 0,
    });
    assert(workspace?.status === 'skipped', 'expected skipped');
    expect(workspace.skipReason).toContain('No bump-worthy commits for arrays since arrays-v1.0.0');
    expect(workspace.skipReason).toContain('Pass --force to release at patch');
    expect(workspace.unparseableCommits).toStrictEqual(makeStubbedCommits([['chore: update deps', 'abc123']]));
  });

  it("falls back to patch when the history's commits don't call for a bump and --force is set", () => {
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

    stubHistory({
      previousTag: 'arrays-v1.0.0',
      commits: [['chore: update deps', 'abc123']],
      unparseableCommits: [['chore: update deps', 'abc123']],
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = prepareMonorepo(config, { shouldForce: true });

    expect(result.tags).toStrictEqual(['arrays-v1.0.1']);
    expect(selectPackageResults(result)[0]).toMatchObject({
      status: 'released',
      commitCount: 1,
      parsedCommitCount: 0,
      releaseType: 'patch',
    });
    expect(selectPackageResults(result)[0]?.unparseableCommits).toStrictEqual(
      makeStubbedCommits([['chore: update deps', 'abc123']]),
    );
  });

  it("skips when --bump=X alone is set and the history's commits don't call for a bump (level chooser, not trigger)", () => {
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

    stubHistory({ previousTag: 'arrays-v1.0.0', commits: [['chore: update deps', 'abc123']] });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = prepareMonorepo(config, { bumpOverride: 'minor' });

    expect(result.tags).toStrictEqual([]);
    const workspace = selectPackageResults(result)[0];
    expect(workspace).toMatchObject({
      status: 'skipped',
      commitCount: 1,
    });
    assert(workspace?.status === 'skipped', 'expected skipped');
    expect(workspace.skipReason).toContain('No bump-worthy commits for arrays since arrays-v1.0.0');
  });

  it('falls back to patch when --force is set without any commits (no --bump)', () => {
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
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = prepareMonorepo(config, { shouldForce: true });

    expect(result.tags).toStrictEqual(['arrays-v1.0.1']);
    const workspace = selectPackageResults(result)[0];
    expect(workspace).toMatchObject({
      status: 'released',
      commitCount: 0,
      parsedCommitCount: 0,
      releaseType: 'patch',
    });
    assert(workspace?.status === 'released', 'expected released');
    expect(workspace.bumpOverride).toBeUndefined();
  });

  it('mixed-sibling case: --force alone uses natural bump for one workspace and patch fallback for another', () => {
    // With `--force` alone (no `--bump`), a workspace whose history calls for a bump keeps it;
    // one whose history calls for none falls back to patch.
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
      'arrays-v': { previousTag: 'arrays-v1.0.0', commits: [['chore: update deps', 'abc123']] },
      'strings-v': { previousTag: 'strings-v2.0.0', commits: [['feat: add helper', 'def456']], bump: 'minor' },
    });
    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('arrays')) return JSON.stringify({ version: '1.0.0' });
      return JSON.stringify({ version: '2.0.0' });
    });

    const result = prepareMonorepo(config, { shouldForce: true });

    // arrays falls back to patch; strings keeps its natural minor.
    expect(result.tags).toStrictEqual(['arrays-v1.0.1', 'strings-v2.1.0']);
    expect(selectPackageResults(result)[0]).toMatchObject({ name: 'arrays', status: 'released', releaseType: 'patch' });
    expect(selectPackageResults(result)[1]).toMatchObject({
      name: 'strings',
      status: 'released',
      releaseType: 'minor',
    });
  });

  it("reports the history's bump, parsed count, and unparseable commits on a released result", () => {
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

    stubHistory({
      previousTag: 'arrays-v1.0.0',
      commits: [
        ['feat: add utility', 'abc123'],
        ['chore: update deps', 'def456'],
      ],
      bump: 'minor',
      parsedCommitCount: 1,
      unparseableCommits: [['chore: update deps', 'def456']],
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = prepareMonorepo(config, {});

    expect(selectPackageResults(result)[0]).toMatchObject({
      status: 'released',
      releaseType: 'minor',
      commitCount: 2,
      parsedCommitCount: 1,
      commits: makeStubbedCommits([
        ['feat: add utility', 'abc123'],
        ['chore: update deps', 'def456'],
      ]),
    });
    expect(selectPackageResults(result)[0]?.unparseableCommits).toStrictEqual(
      makeStubbedCommits([['chore: update deps', 'def456']]),
    );
  });

  it('bypasses the no-commits check when shouldForce is true', () => {
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
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = prepareMonorepo(config, { shouldForce: true, bumpOverride: 'patch' });

    expect(result.tags).toStrictEqual(['arrays-v1.0.1']);
    expect(plannedContent(result, 'packages/arrays/package.json')).toContain('"version": "1.0.1"');
    // Empty-range release: the synthetic "Notes / Forced version bump." entry stands in for
    // the release windows.
    expect(mockBuildEmptyReleaseEntry).toHaveBeenCalledExactlyOnceWith('1.0.1', expect.any(String));
    expect(listReadOptions()).toStrictEqual([
      { tagPrefixes: ['arrays-v'], paths: ['packages/arrays/**'], scope: 'arrays' },
    ]);
  });

  it('force-bumps a workspace without any commits while also bumping one with commits', () => {
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
      'arrays-v': { previousTag: 'arrays-v1.0.0' },
      'strings-v': { previousTag: 'strings-v2.0.0', commits: [['feat: add string helper', 'abc123']], bump: 'minor' },
    });
    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('arrays')) return JSON.stringify({ version: '1.0.0' });
      return JSON.stringify({ version: '2.0.0' });
    });

    const result = prepareMonorepo(config, { shouldForce: true, bumpOverride: 'patch' });

    // arrays is bumped via --force (0 commits); strings via its history's bump; both use bumpOverride: 'patch'
    expect(result.tags).toStrictEqual(['arrays-v1.0.1', 'strings-v2.0.1']);
  });

  it('force-bumps an empty range from the synthetic entry without writing', () => {
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

    stubHistory({ previousTag: 'arrays-v1.0.0', releasedEntries: [RELEASED_ENTRY] });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = prepareMonorepo(config, { shouldForce: true, bumpOverride: 'patch' });

    expect(result.tags).toStrictEqual(['arrays-v1.0.1']);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(mockMergeChangelogEntriesWithDisk).toHaveBeenCalledExactlyOnceWith(expect.any(String), [
      FORCED_BUMP_ENTRY,
      RELEASED_ENTRY,
    ]);
  });
});
