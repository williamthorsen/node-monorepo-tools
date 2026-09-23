import { captureError, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());
const mockExecSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockHasPrettierConfig = vi.hoisted(() => vi.fn());
const mockPlanReleaseNotesPreviews = vi.hoisted(() => vi.fn());

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
// stays real, so a history's sections reach the planned changelog labeled with the new tag.
const mockReadReleaseHistory = vi.hoisted(() => vi.fn());
const mockBuildSyntheticChangelogEntry = vi.hoisted(() => vi.fn());
const mockBuildEmptyReleaseEntry = vi.hoisted(() => vi.fn());
const mockMergeChangelogEntriesWithDisk = vi.hoisted(() => vi.fn());
const mockRenderChangelogMarkdown = vi.hoisted(() => vi.fn());
const mockRenderChangelogJson = vi.hoisted(() => vi.fn());

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
  renderChangelogMarkdown: mockRenderChangelogMarkdown,
}));

import { DEFAULT_CHANGELOG_JSON_CONFIG, DEFAULT_RELEASE_NOTES_CONFIG } from '../defaults.ts';
import { releasePrepareMono } from '../releasePrepareMono.ts';
import { makeStubbedCommits } from '../test-utils/commitStubs.ts';
import { makeReleaseHistory, type ReleaseHistoryStub } from '../test-utils/releaseHistories.ts';
import type {
  ChangelogEntry,
  ChangelogSection,
  MalformedChangeRecordBlock,
  MonorepoReleaseConfig,
  PolicyViolation,
  UndeclaredEntryType,
  WorkspaceConfig,
  WorkTypeConfig,
} from '../types.ts';

/** The entry that the mocked `buildEmptyReleaseEntry` returns. */
const FORCED_BUMP_ENTRY: ChangelogEntry = {
  version: '0.0.0',
  date: '2024-01-01',
  sections: [{ title: 'Notes', audience: 'dev', items: [{ description: 'Forced version bump.' }] }],
};

/** An entry of a released window, which a history reports alongside its unreleased window. */
const RELEASED_ENTRY: ChangelogEntry = {
  version: '1.0.0',
  date: '2023-12-01',
  sections: [{ title: 'Features', audience: 'all', items: [{ description: 'Initial release', hash: 'old0001' }] }],
};

const workTypes: Record<string, WorkTypeConfig> = {
  feat: { header: 'Features' },
  fix: { header: 'Bug fixes' },
};

function makeConfig(overrides?: Partial<MonorepoReleaseConfig>): MonorepoReleaseConfig {
  return {
    workspaces: [],
    workTypes,
    changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: false },
    releaseNotes: { ...DEFAULT_RELEASE_NOTES_CONFIG },
    ...overrides,
  };
}

describe(releasePrepareMono, () => {
  beforeEach(() => {
    // Default: every scope reads an empty history, and the synthetic constructor returns an empty
    // stub entry. Individual tests can override if needed.
    mockReadReleaseHistory.mockReturnValue(makeReleaseHistory());
    mockBuildSyntheticChangelogEntry.mockReturnValue({ version: '0.0.0', date: '2024-01-01', sections: [] });
    mockBuildEmptyReleaseEntry.mockReturnValue(FORCED_BUMP_ENTRY);
    mockMergeChangelogEntriesWithDisk.mockImplementation((_filePath: string, entries: unknown[]) => entries);
    mockRenderChangelogMarkdown.mockReturnValue('# Changelog\n');
    mockRenderChangelogJson.mockReturnValue('[]\n');
    mockPlanReleaseNotesPreviews.mockReturnValue({ writes: [], warnings: [] });
  });

  afterEach(() => {
    mockExecFileSync.mockReset();
    mockExecSync.mockReset();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockHasPrettierConfig.mockReset();
    mockPlanReleaseNotesPreviews.mockReset();
    mockReadReleaseHistory.mockReset();
    mockBuildSyntheticChangelogEntry.mockReset();
    mockBuildEmptyReleaseEntry.mockReset();
    mockMergeChangelogEntriesWithDisk.mockReset();
    mockRenderChangelogMarkdown.mockReset();
    mockRenderChangelogJson.mockReset();
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
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
      ],
    });

    stubHistory({ previousTag: 'arrays-v1.0.0', commits: [['feat: add utility', 'abc123']], bump: 'minor' });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, {});

    expect(result.tags).toStrictEqual(['arrays-v1.1.0']);
    expect(result.workspaces).toHaveLength(1);
    expect(result.workspaces[0]).toMatchObject({
      name: 'arrays',
      status: 'released',
      tag: 'arrays-v1.1.0',
      currentVersion: '1.0.0',
      newVersion: '1.1.0',
      changelogFiles: ['packages/arrays/CHANGELOG.md'],
    });

    // Verify the plan carries the new version
    expect(plannedContent(result, 'packages/arrays/package.json')).toContain('"version": "1.1.0"');
    expect(mockWriteFileSync).not.toHaveBeenCalled();

    // Verify the history was read once, under the workspace's own tag prefixes and paths
    expect(listReadOptions()).toStrictEqual([{ tagPrefixes: ['arrays-v'], paths: ['packages/arrays/**'] }]);
    expect(result.writes.map((write) => write.path)).toContain('packages/arrays/CHANGELOG.md');
  });

  it('skips a workspace with no commits', () => {
    const config = makeConfig({
      workspaces: [
        {
          dir: 'arrays',
          name: '@test/arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
          isPublishable: true,
          packageFiles: ['packages/arrays/package.json'],
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
      ],
    });

    stubHistory({ previousTag: 'arrays-v1.0.0' });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/arrays', version: '1.0.0' }));

    const result = releasePrepareMono(config, {});

    expect(result.tags).toStrictEqual([]);
    expect(result.workspaces).toHaveLength(1);
    expect(result.workspaces[0]).toMatchObject({
      name: 'arrays',
      status: 'skipped',
      commitCount: 0,
      parsedCommitCount: 0,
      previousTag: 'arrays-v1.0.0',
    });
    assert(result.workspaces[0]?.status === 'skipped', 'expected skipped');
    expect(result.workspaces[0].skipReason).toContain('No commits for arrays since arrays-v1.0.0');
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(result.writes).toStrictEqual([]);
    expect(listReadOptions()).toStrictEqual([{ tagPrefixes: ['arrays-v'], paths: ['packages/arrays/**'] }]);
  });

  it('skips a workspace with no commits whose package.json has no version', () => {
    const config = makeConfig({
      workspaces: [
        {
          dir: 'arrays',
          name: '@test/arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
          isPublishable: false,
          packageFiles: ['packages/arrays/package.json'],
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
      ],
    });

    stubHistory({ previousTag: 'arrays-v1.0.0' });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/arrays', private: true }));

    const result = releasePrepareMono(config, {});

    expect(result.tags).toStrictEqual([]);
    expect(result.workspaces).toStrictEqual([expect.objectContaining({ name: 'arrays', status: 'skipped' })]);
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
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
        {
          dir: 'strings',
          name: '@test/strings',
          tagPrefix: 'strings-v',
          workspacePath: 'packages/strings',
          isPublishable: true,
          packageFiles: ['packages/strings/package.json'],
          changelogPaths: ['packages/strings'],
          paths: ['packages/strings/**'],
        },
      ],
    });

    stubHistoryByPrefix({
      'arrays-v': { previousTag: 'arrays-v1.0.0', commits: [['fix: fix array bug', 'def456']], bump: 'patch' },
      'strings-v': { previousTag: 'strings-v2.0.0' },
    });

    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, {});

    expect(result.tags).toStrictEqual(['arrays-v1.0.1']);
    expect(result.workspaces).toHaveLength(2);
    expect(result.workspaces[0]).toMatchObject({ name: 'arrays', status: 'released' });
    expect(result.workspaces[1]).toMatchObject({ name: 'strings', status: 'skipped' });

    // Only arrays package.json should be planned
    expect(result.writes.map((write) => write.path)).toContain('packages/arrays/package.json');
    expect(result.writes.map((write) => write.path)).not.toContain('packages/strings/package.json');

    // Only arrays changelog should be generated
    expect(result.writes.map((write) => write.path)).toContain('packages/arrays/CHANGELOG.md');
    expect(result.writes.map((write) => write.path)).not.toContain('packages/strings/CHANGELOG.md');

    // Each workspace's history is read once, the skipped one included
    expect(listReadOptions()).toStrictEqual([
      { tagPrefixes: ['arrays-v'], paths: ['packages/arrays/**'] },
      { tagPrefixes: ['strings-v'], paths: ['packages/strings/**'] },
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
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
      ],
    });

    stubHistory({ previousTag: 'arrays-v1.0.0', commits: [['feat: add feature', 'abc123']], bump: 'minor' });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, {});

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
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
        {
          dir: 'strings',
          name: '@test/strings',
          tagPrefix: 'strings-v',
          workspacePath: 'packages/strings',
          isPublishable: true,
          packageFiles: ['packages/strings/package.json'],
          changelogPaths: ['packages/strings'],
          paths: ['packages/strings/**'],
        },
      ],
    });

    stubHistoryByPrefix({
      'arrays-v': { previousTag: 'arrays-v1.0.0', commits: [['feat: add feature', 'abc123']], bump: 'minor' },
      'strings-v': { previousTag: 'strings-v1.0.0', commits: [['feat: add feature', 'abc123']], bump: 'minor' },
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, {});

    expect(mockExecSync).not.toHaveBeenCalled();
    expect(result.formatCommand?.command).toBe(
      'npx prettier --write packages/arrays/package.json packages/arrays/CHANGELOG.md packages/strings/package.json packages/strings/CHANGELOG.md',
    );
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
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
      ],
    });

    const sections: ChangelogSection[] = [
      { title: 'Bug fixes', audience: 'all', items: [{ description: 'Small patch', hash: 'abc123' }] },
    ];
    stubHistory({ previousTag: 'arrays-v1.0.0', commits: [['fix: small patch', 'abc123']], bump: 'patch', sections });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, { bumpOverride: 'minor' });

    expect(result.tags).toStrictEqual(['arrays-v1.1.0']);

    // Should use the override (minor) rather than the history's bump (patch)
    expect(plannedContent(result, 'packages/arrays/package.json')).toContain('"version": "1.1.0"');
    expect(result.workspaces[0]).toMatchObject({ releaseType: 'minor', bumpOverride: 'minor' });

    expect(mockMergeChangelogEntriesWithDisk).toHaveBeenCalledExactlyOnceWith(expect.any(String), [
      { version: '1.1.0', date: '2024-01-01', sections },
    ]);
  });

  it('skips when the history has commits but no bump and no --force is given', () => {
    const config = makeConfig({
      workspaces: [
        {
          dir: 'arrays',
          name: '@test/arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
          isPublishable: true,
          packageFiles: ['packages/arrays/package.json'],
          changelogPaths: ['packages/arrays'],
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

    const result = releasePrepareMono(config, {});

    expect(result.tags).toStrictEqual([]);
    const workspace = result.workspaces[0];
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

  it('falls back to patch when the history has commits but no bump and --force is set', () => {
    const config = makeConfig({
      workspaces: [
        {
          dir: 'arrays',
          name: '@test/arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
          isPublishable: true,
          packageFiles: ['packages/arrays/package.json'],
          changelogPaths: ['packages/arrays'],
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

    const result = releasePrepareMono(config, { force: true });

    expect(result.tags).toStrictEqual(['arrays-v1.0.1']);
    expect(result.workspaces[0]).toMatchObject({
      status: 'released',
      commitCount: 1,
      parsedCommitCount: 0,
      releaseType: 'patch',
    });
    expect(result.workspaces[0]?.unparseableCommits).toStrictEqual(
      makeStubbedCommits([['chore: update deps', 'abc123']]),
    );
  });

  it('skips when --bump=X alone is set and the history has commits but no bump (level chooser, not trigger)', () => {
    const config = makeConfig({
      workspaces: [
        {
          dir: 'arrays',
          name: '@test/arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
          isPublishable: true,
          packageFiles: ['packages/arrays/package.json'],
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
      ],
    });

    stubHistory({ previousTag: 'arrays-v1.0.0', commits: [['chore: update deps', 'abc123']] });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, { bumpOverride: 'minor' });

    expect(result.tags).toStrictEqual([]);
    const workspace = result.workspaces[0];
    expect(workspace).toMatchObject({
      status: 'skipped',
      commitCount: 1,
    });
    assert(workspace?.status === 'skipped', 'expected skipped');
    expect(workspace.skipReason).toContain('No bump-worthy commits for arrays since arrays-v1.0.0');
  });

  it('falls back to patch when --force is set with no commits (no --bump)', () => {
    const config = makeConfig({
      workspaces: [
        {
          dir: 'arrays',
          name: '@test/arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
          isPublishable: true,
          packageFiles: ['packages/arrays/package.json'],
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
      ],
    });

    stubHistory({ previousTag: 'arrays-v1.0.0' });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, { force: true });

    expect(result.tags).toStrictEqual(['arrays-v1.0.1']);
    const workspace = result.workspaces[0];
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
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
        {
          dir: 'strings',
          name: '@test/strings',
          tagPrefix: 'strings-v',
          workspacePath: 'packages/strings',
          isPublishable: true,
          packageFiles: ['packages/strings/package.json'],
          changelogPaths: ['packages/strings'],
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

    const result = releasePrepareMono(config, { force: true });

    // arrays falls back to patch; strings keeps its natural minor.
    expect(result.tags).toStrictEqual(['arrays-v1.0.1', 'strings-v2.1.0']);
    expect(result.workspaces[0]).toMatchObject({ name: 'arrays', status: 'released', releaseType: 'patch' });
    expect(result.workspaces[1]).toMatchObject({ name: 'strings', status: 'released', releaseType: 'minor' });
  });

  it("carries the history's bump, parsed count, and unparseable commits onto a released result", () => {
    const config = makeConfig({
      workspaces: [
        {
          dir: 'arrays',
          name: '@test/arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
          isPublishable: true,
          packageFiles: ['packages/arrays/package.json'],
          changelogPaths: ['packages/arrays'],
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

    const result = releasePrepareMono(config, {});

    expect(result.workspaces[0]).toMatchObject({
      status: 'released',
      releaseType: 'minor',
      commitCount: 2,
      parsedCommitCount: 1,
      commits: makeStubbedCommits([
        ['feat: add utility', 'abc123'],
        ['chore: update deps', 'def456'],
      ]),
    });
    expect(result.workspaces[0]?.unparseableCommits).toStrictEqual(
      makeStubbedCommits([['chore: update deps', 'def456']]),
    );
  });

  it('bypasses the no-commits check when force is true', () => {
    const config = makeConfig({
      workspaces: [
        {
          dir: 'arrays',
          name: '@test/arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
          isPublishable: true,
          packageFiles: ['packages/arrays/package.json'],
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
      ],
    });

    stubHistory({ previousTag: 'arrays-v1.0.0' });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, { force: true, bumpOverride: 'patch' });

    expect(result.tags).toStrictEqual(['arrays-v1.0.1']);
    expect(plannedContent(result, 'packages/arrays/package.json')).toContain('"version": "1.0.1"');
    // Empty-range release: the synthetic "Notes / Forced version bump." entry stands in for
    // the release windows.
    expect(mockBuildEmptyReleaseEntry).toHaveBeenCalledExactlyOnceWith('1.0.1', expect.any(String));
    expect(listReadOptions()).toStrictEqual([{ tagPrefixes: ['arrays-v'], paths: ['packages/arrays/**'] }]);
  });

  it('force-bumps a workspace with no commits while also bumping one with commits', () => {
    const config = makeConfig({
      workspaces: [
        {
          dir: 'arrays',
          name: '@test/arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
          isPublishable: true,
          packageFiles: ['packages/arrays/package.json'],
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
        {
          dir: 'strings',
          name: '@test/strings',
          tagPrefix: 'strings-v',
          workspacePath: 'packages/strings',
          isPublishable: true,
          packageFiles: ['packages/strings/package.json'],
          changelogPaths: ['packages/strings'],
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

    const result = releasePrepareMono(config, { force: true, bumpOverride: 'patch' });

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
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
      ],
    });

    stubHistory({ previousTag: 'arrays-v1.0.0', releasedEntries: [RELEASED_ENTRY] });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, { force: true, bumpOverride: 'patch' });

    expect(result.tags).toStrictEqual(['arrays-v1.0.1']);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(mockMergeChangelogEntriesWithDisk).toHaveBeenCalledExactlyOnceWith(expect.any(String), [
      FORCED_BUMP_ENTRY,
      RELEASED_ENTRY,
    ]);
  });

  it('does not run formatCommand when no workspaces have commits', () => {
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
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
      ],
    });

    stubHistory({ previousTag: 'arrays-v1.0.0' });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/arrays', version: '1.0.0' }));

    const result = releasePrepareMono(config, {});

    expect(result.tags).toStrictEqual([]);
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('defaults to prettier when no formatCommand is set and prettier config exists', () => {
    const config = makeConfig({
      workspaces: [
        {
          dir: 'arrays',
          name: '@test/arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
          isPublishable: true,
          packageFiles: ['packages/arrays/package.json'],
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
      ],
    });
    mockHasPrettierConfig.mockReturnValue(true);

    stubHistory({ previousTag: 'arrays-v1.0.0', commits: [['feat: add feature', 'abc123']], bump: 'minor' });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, {});

    expect(result.formatCommand?.command).toBe(
      'npx prettier --write packages/arrays/package.json packages/arrays/CHANGELOG.md',
    );
  });

  it('skips formatting when no formatCommand is set and no prettier config exists', () => {
    const config = makeConfig({
      workspaces: [
        {
          dir: 'arrays',
          name: '@test/arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
          isPublishable: true,
          packageFiles: ['packages/arrays/package.json'],
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
      ],
    });
    mockHasPrettierConfig.mockReturnValue(false);

    stubHistory({ previousTag: 'arrays-v1.0.0', commits: [['feat: add feature', 'abc123']], bump: 'minor' });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    releasePrepareMono(config, {});

    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('generates a changelog for each entry in changelogPaths', () => {
    const config = makeConfig({
      workspaces: [
        {
          dir: 'arrays',
          name: '@test/arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
          isPublishable: true,
          packageFiles: ['packages/arrays/package.json'],
          changelogPaths: ['packages/arrays', 'packages/arrays/docs'],
          paths: ['packages/arrays/**'],
        },
      ],
    });

    stubHistory({ previousTag: 'arrays-v1.0.0', commits: [['feat: add utility', 'abc123']], bump: 'minor' });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, {});

    expect(result.tags).toStrictEqual(['arrays-v1.1.0']);
    const workspace = result.workspaces[0];
    assert(workspace?.status === 'released', 'expected released');
    expect(workspace.changelogFiles).toStrictEqual([
      'packages/arrays/CHANGELOG.md',
      'packages/arrays/docs/CHANGELOG.md',
    ]);
    // The history is read once per workspace (it spans the full release history), and the markdown
    // renderer is called once per `changelogPaths` entry.
    expect(mockReadReleaseHistory).toHaveBeenCalledTimes(1);
    expect(mockRenderChangelogMarkdown).toHaveBeenCalledTimes(2);
    expect(
      result.writes.filter((write) => write.path.endsWith('CHANGELOG.md')).map((write) => write.path),
    ).toStrictEqual(['packages/arrays/CHANGELOG.md', 'packages/arrays/docs/CHANGELOG.md']);
  });

  describe('dependency propagation', () => {
    it('propagates a patch bump to a dependent when a dependency is bumped', () => {
      const config = makeConfig({
        workspaces: [
          {
            dir: 'core',
            name: '@test/core',
            tagPrefix: 'core-v',
            workspacePath: 'packages/core',
            isPublishable: true,
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
          },
          {
            dir: 'app',
            name: '@test/app',
            tagPrefix: 'app-v',
            workspacePath: 'packages/app',
            isPublishable: true,
            packageFiles: ['packages/app/package.json'],
            changelogPaths: ['packages/app'],
            paths: ['packages/app/**'],
          },
        ],
      });

      stubHistoryByPrefix({
        'core-v': { previousTag: 'core-v1.0.0', commits: [['feat: add utility', 'abc123']], bump: 'minor' },
        'app-v': { previousTag: 'app-v2.0.0' },
      });

      mockReadFileSync.mockImplementation((filePath: string) => {
        if (filePath.includes('core')) {
          return JSON.stringify({
            name: '@test/core',
            version: '1.0.0',
          });
        }
        if (filePath.includes('app')) {
          return JSON.stringify({
            name: '@test/app',
            version: '2.0.0',
            dependencies: { '@test/core': 'workspace:*' },
          });
        }
        return '{}';
      });
      mockExistsSync.mockReturnValue(false);

      const result = releasePrepareMono(config, {});

      // core is bumped directly (minor), app is propagated (patch).
      expect(result.tags).toContain('core-v1.1.0');
      expect(result.tags).toContain('app-v2.0.1');
      expect(result.workspaces).toHaveLength(2);

      const coreResult = result.workspaces.find((c) => c.name === 'core');
      expect(coreResult).toMatchObject({
        status: 'released',
        releaseType: 'minor',
        newVersion: '1.1.0',
      });

      const appResult = result.workspaces.find((c) => c.name === 'app');
      expect(appResult).toMatchObject({
        status: 'released',
        releaseType: 'patch',
        newVersion: '2.0.1',
        commitCount: 0,
        propagatedFrom: [{ packageName: '@test/core', newVersion: '1.1.0' }],
      });
    });

    it('writes a synthetic changelog for propagated-only workspaces', () => {
      const config = makeConfig({
        workspaces: [
          {
            dir: 'core',
            name: '@test/core',
            tagPrefix: 'core-v',
            workspacePath: 'packages/core',
            isPublishable: true,
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
          },
          {
            dir: 'app',
            name: '@test/app',
            tagPrefix: 'app-v',
            workspacePath: 'packages/app',
            isPublishable: true,
            packageFiles: ['packages/app/package.json'],
            changelogPaths: ['packages/app'],
            paths: ['packages/app/**'],
          },
        ],
      });

      stubHistoryByPrefix({
        'core-v': { previousTag: 'core-v1.0.0', commits: [['fix: bug fix', 'abc123']], bump: 'patch' },
        'app-v': { previousTag: 'app-v1.0.0' },
      });

      mockReadFileSync.mockImplementation((filePath: string) => {
        if (filePath.includes('core')) {
          return JSON.stringify({ name: '@test/core', version: '1.0.0' });
        }
        if (filePath.includes('app')) {
          return JSON.stringify({
            name: '@test/app',
            version: '1.0.0',
            dependencies: { '@test/core': 'workspace:*' },
          });
        }
        return '{}';
      });
      mockExistsSync.mockReturnValue(false);

      const result = releasePrepareMono(config, {});

      // Each workspace's history is read once, in Phase 1; building the propagated app's changelog
      // reads nothing more.
      expect(listReadOptions()).toStrictEqual([
        { tagPrefixes: ['core-v'], paths: ['packages/core/**'] },
        { tagPrefixes: ['app-v'], paths: ['packages/app/**'] },
      ]);
      expect(result.writes.map((write) => write.path)).toContain('packages/core/CHANGELOG.md');

      // Synthetic propagation entry constructor was called for the app workspace.
      expect(mockBuildSyntheticChangelogEntry).toHaveBeenCalledTimes(1);
      const propagatedFromArg = mockBuildSyntheticChangelogEntry.mock.calls[0]?.[0];
      expect(JSON.stringify(propagatedFromArg)).toContain('@test/core');
      // The app's changelog is planned alongside core's.
      expect(result.writes.map((write) => write.path)).toContain('packages/app/CHANGELOG.md');
    });

    it('does not propagate to workspaces excluded from config.workspaces', () => {
      // Only include "core" in config — "app" that depends on core is not listed.
      const config = makeConfig({
        workspaces: [
          {
            dir: 'core',
            name: '@test/core',
            tagPrefix: 'core-v',
            workspacePath: 'packages/core',
            isPublishable: true,
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
          },
        ],
      });

      stubHistory({ previousTag: 'core-v1.0.0', commits: [['feat: new feature', 'abc123']], bump: 'minor' });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/core', version: '1.0.0' }));

      const result = releasePrepareMono(config, {});

      // Only core should be released since app is not in config.workspaces.
      expect(result.tags).toStrictEqual(['core-v1.1.0']);
      expect(result.workspaces).toHaveLength(1);
    });

    it('writes the explicit --set-version value in monorepo mode', () => {
      const config = makeConfig({
        workspaces: [
          {
            dir: 'core',
            name: '@test/core',
            tagPrefix: 'core-v',
            workspacePath: 'packages/core',
            isPublishable: true,
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
          },
        ],
      });

      stubHistory({ previousTag: 'core-v0.5.0' });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/core', version: '0.5.0' }));
      mockExistsSync.mockReturnValue(false);

      const result = releasePrepareMono(config, { setVersion: '1.0.0' });

      const coreResult = result.workspaces.find((c) => c.name === 'core');
      expect(coreResult).toMatchObject({
        status: 'released',
        newVersion: '1.0.0',
        currentVersion: '0.5.0',
        setVersion: '1.0.0',
      });
      assert(coreResult?.status === 'released', 'expected released');
      expect(coreResult.releaseType).toBeUndefined();
      expect(result.tags).toStrictEqual(['core-v1.0.0']);
      expect(plannedContent(result, 'packages/core/package.json')).toContain('"version": "1.0.0"');
    });

    it("builds a --set-version changelog from the workspace's one history read, leaving the decision's counts off", () => {
      const config = makeConfig({
        workspaces: [
          {
            dir: 'core',
            name: '@test/core',
            tagPrefix: 'core-v',
            workspacePath: 'packages/core',
            isPublishable: true,
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
          },
        ],
      });
      const sections: ChangelogSection[] = [
        { title: 'Bug fixes', audience: 'all', items: [{ description: 'Core fix', hash: 'abc123' }] },
      ];
      stubHistory({
        previousTag: 'core-v0.5.0',
        commits: [
          ['fix: core fix', 'abc123'],
          ['chore: tidy', 'def456'],
        ],
        bump: 'patch',
        parsedCommitCount: 1,
        unparseableCommits: [['chore: tidy', 'def456']],
        sections,
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/core', version: '0.5.0' }));
      mockExistsSync.mockReturnValue(false);

      const result = releasePrepareMono(config, { setVersion: '1.0.0' });

      expect(listReadOptions()).toStrictEqual([{ tagPrefixes: ['core-v'], paths: ['packages/core/**'] }]);
      expect(mockMergeChangelogEntriesWithDisk).toHaveBeenCalledExactlyOnceWith(expect.any(String), [
        { version: '1.0.0', date: '2024-01-01', sections },
      ]);
      const coreResult = result.workspaces[0];
      assert(coreResult?.status === 'released', 'expected released');
      expect(coreResult).toMatchObject({ commitCount: 2, setVersion: '1.0.0', previousTag: 'core-v0.5.0' });
      expect(coreResult.releaseType).toBeUndefined();
      expect(coreResult.parsedCommitCount).toBeUndefined();
      expect(coreResult.unparseableCommits).toBeUndefined();
    });

    it('throws when --set-version is not greater than the current version', () => {
      const config = makeConfig({
        workspaces: [
          {
            dir: 'core',
            name: '@test/core',
            tagPrefix: 'core-v',
            workspacePath: 'packages/core',
            isPublishable: true,
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
          },
        ],
      });

      stubHistory({ previousTag: 'core-v0.5.0' });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/core', version: '0.5.0' }));

      expect(() => releasePrepareMono(config, { setVersion: '0.3.0' })).toThrow(
        '--set-version 0.3.0 is not greater than current version 0.5.0',
      );
    });

    it('throws when --set-version equals the current version', () => {
      const config = makeConfig({
        workspaces: [
          {
            dir: 'core',
            name: '@test/core',
            tagPrefix: 'core-v',
            workspacePath: 'packages/core',
            isPublishable: true,
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
          },
        ],
      });

      stubHistory({ previousTag: 'core-v0.5.0' });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/core', version: '0.5.0' }));

      expect(() => releasePrepareMono(config, { setVersion: '0.5.0' })).toThrow(
        '--set-version 0.5.0 is not greater than current version 0.5.0',
      );
    });

    it('plans the --set-version tag without writing any file', () => {
      const config = makeConfig({
        workspaces: [
          {
            dir: 'core',
            name: '@test/core',
            tagPrefix: 'core-v',
            workspacePath: 'packages/core',
            isPublishable: true,
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
          },
        ],
      });

      stubHistory({ previousTag: 'core-v0.5.0' });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/core', version: '0.5.0' }));
      mockExistsSync.mockReturnValue(false);

      const result = releasePrepareMono(config, { setVersion: '1.0.0' });

      expect(result.tags).toStrictEqual(['core-v1.0.0']);
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('throws when --set-version is used with more than one workspace', () => {
      // Explicit guard in `determineDirectBumps` enforces the single-workspace contract for
      // --set-version even if a caller bypasses the CLI layer that normally narrows via --only.
      const config = makeConfig({
        workspaces: [
          {
            dir: 'core',
            name: '@test/core',
            tagPrefix: 'core-v',
            workspacePath: 'packages/core',
            isPublishable: true,
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
          },
          {
            dir: 'app',
            name: '@test/app',
            tagPrefix: 'app-v',
            workspacePath: 'packages/app',
            isPublishable: true,
            packageFiles: ['packages/app/package.json'],
            changelogPaths: ['packages/app'],
            paths: ['packages/app/**'],
          },
        ],
      });

      expect(() => releasePrepareMono(config, { setVersion: '1.0.0' })).toThrow(
        '--set-version requires exactly one workspace',
      );
    });

    it('preserves a direct higher bump when propagation would add a patch', () => {
      const config = makeConfig({
        workspaces: [
          {
            dir: 'core',
            name: '@test/core',
            tagPrefix: 'core-v',
            workspacePath: 'packages/core',
            isPublishable: true,
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
          },
          {
            dir: 'app',
            name: '@test/app',
            tagPrefix: 'app-v',
            workspacePath: 'packages/app',
            isPublishable: true,
            packageFiles: ['packages/app/package.json'],
            changelogPaths: ['packages/app'],
            paths: ['packages/app/**'],
          },
        ],
      });

      stubHistoryByPrefix({
        'core-v': { previousTag: 'core-v1.0.0', commits: [['fix: core fix', 'abc123']], bump: 'patch' },
        'app-v': { previousTag: 'app-v2.0.0', commits: [['feat: app feature', 'def456']], bump: 'minor' },
      });

      mockReadFileSync.mockImplementation((filePath: string) => {
        if (filePath.includes('core')) {
          return JSON.stringify({ name: '@test/core', version: '1.0.0' });
        }
        if (filePath.includes('app')) {
          return JSON.stringify({
            name: '@test/app',
            version: '2.0.0',
            dependencies: { '@test/core': 'workspace:*' },
          });
        }
        return '{}';
      });

      const result = releasePrepareMono(config, {});

      // app has its own minor bump from commits; propagation adds metadata but keeps minor.
      const appResult = result.workspaces.find((c) => c.name === 'app');
      expect(appResult).toMatchObject({
        status: 'released',
        releaseType: 'minor',
        propagatedFrom: [{ packageName: '@test/core', newVersion: '1.0.1' }],
      });
    });
  });

  describe('releases whose window yields no item', () => {
    // When a workspace is forced to release (`--force`, `--bump=X`, or `--set-version`) although
    // its unreleased window yields no changelog item, a synthetic "Notes / Forced version bump."
    // entry stands in for that window.

    /** Helper config with one empty-range workspace. */
    function singleWorkspaceConfig(overrides?: Partial<MonorepoReleaseConfig>): MonorepoReleaseConfig {
      const workspace: WorkspaceConfig = {
        dir: 'arrays',
        name: '@test/arrays',
        tagPrefix: 'arrays-v',
        workspacePath: 'packages/arrays',
        isPublishable: true,
        packageFiles: ['packages/arrays/package.json'],
        changelogPaths: ['packages/arrays'],
        paths: ['packages/arrays/**'],
      };
      return makeConfig({ workspaces: [workspace], ...overrides });
    }

    /** Stubs a history with a baseline tag but no commits since it. */
    function stubEmptyRange(): void {
      stubHistory({ previousTag: 'arrays-v1.0.0' });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/arrays', version: '1.0.0' }));
      mockExistsSync.mockReturnValue(false);
    }

    it('writes a synthetic Notes / Forced version bump entry when --force is used with no commits', () => {
      stubEmptyRange();

      const result = releasePrepareMono(singleWorkspaceConfig(), { force: true });

      expect(result.tags).toStrictEqual(['arrays-v1.0.1']);

      // The empty-range branch builds a synthetic Notes entry (mocked) and routes it through
      // the markdown renderer; assert on the renderer's args.
      expect(mockBuildEmptyReleaseEntry).toHaveBeenCalledWith('1.0.1', expect.any(String));
      expect(result.writes.map((write) => write.path)).toContain('packages/arrays/CHANGELOG.md');
    });

    it.each([
      ['--force', { force: true }, '1.0.1'],
      ['--set-version', { setVersion: '2.0.0' }, '2.0.0'],
    ])(
      'writes the synthetic entry under %s when the window has commits but yields no item',
      (_label, options, version) => {
        stubEmptyRange();
        stubHistory({
          previousTag: 'arrays-v1.0.0',
          commits: [
            ['fmt: reformat', 'abc123'],
            ['update readme', 'def456'],
          ],
        });

        const result = releasePrepareMono(singleWorkspaceConfig(), options);

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

      const result = releasePrepareMono(singleWorkspaceConfig(), { force: true, bumpOverride: 'minor' });

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

      const result = releasePrepareMono(singleWorkspaceConfig(), { bumpOverride: 'minor' });

      expect(result.tags).toStrictEqual([]);
      expect(result.workspaces[0]).toMatchObject({ status: 'skipped', commitCount: 0 });
      expect(mockBuildEmptyReleaseEntry).not.toHaveBeenCalled();
    });

    it('upserts a synthetic empty-range entry into changelog.json when enabled', () => {
      stubEmptyRange();

      releasePrepareMono(
        singleWorkspaceConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }),
        { force: true },
      );

      expect(mockBuildEmptyReleaseEntry).toHaveBeenCalledTimes(1);
      expect(mockBuildEmptyReleaseEntry).toHaveBeenCalledWith('1.0.1', expect.any(String));
      expect(mockReadReleaseHistory).toHaveBeenCalledTimes(1);
      expect(mockRenderChangelogJson).toHaveBeenCalledTimes(1);
    });

    it('keeps propagation-only workspaces on the propagation path (no regression)', () => {
      const config = makeConfig({
        workspaces: [
          {
            dir: 'core',
            name: '@test/core',
            tagPrefix: 'core-v',
            workspacePath: 'packages/core',
            isPublishable: true,
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
          },
          {
            dir: 'app',
            name: '@test/app',
            tagPrefix: 'app-v',
            workspacePath: 'packages/app',
            isPublishable: true,
            packageFiles: ['packages/app/package.json'],
            changelogPaths: ['packages/app'],
            paths: ['packages/app/**'],
          },
        ],
      });

      stubHistoryByPrefix({
        'core-v': {
          previousTag: 'core-v1.0.0',
          commits: [['fix: bug fix', 'abc123']],
          bump: 'patch',
          sections: [{ title: 'Bug fixes', audience: 'all', items: [{ description: 'Bug fix', hash: 'abc123' }] }],
        },
        'app-v': { previousTag: 'app-v1.0.0' },
      });
      mockReadFileSync.mockImplementation((filePath: string) => {
        if (filePath.includes('core')) {
          return JSON.stringify({ name: '@test/core', version: '1.0.0' });
        }
        if (filePath.includes('app')) {
          return JSON.stringify({
            name: '@test/app',
            version: '1.0.0',
            dependencies: { '@test/core': 'workspace:*' },
          });
        }
        return '{}';
      });
      mockExistsSync.mockReturnValue(false);

      releasePrepareMono(config, {});

      // The propagation-only path constructs a synthetic propagation entry, not an empty-range
      // entry. Both constructors are mocked, so observe the call counts.
      expect(mockBuildSyntheticChangelogEntry).toHaveBeenCalledTimes(1);
      // For the app workspace specifically, the empty-range entry is NOT used.
      // (The test only has core + app, and core is on the release-window path → no empty-range
      // build for any workspace.)
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

      releasePrepareMono(config, {});

      // Real commits → the unreleased window, labeled with the new tag, leads the released windows.
      expect(mockBuildEmptyReleaseEntry).not.toHaveBeenCalled();
      expect(mockMergeChangelogEntriesWithDisk).toHaveBeenCalledExactlyOnceWith(expect.any(String), [
        { version: '1.1.0', date: '2024-01-01', sections },
        RELEASED_ENTRY,
      ]);
    });

    it('does not write synthetic entries for workspaces correctly skipped (no commits, no --force)', () => {
      stubEmptyRange();

      const result = releasePrepareMono(singleWorkspaceConfig(), {});

      expect(result.tags).toStrictEqual([]);
      expect(result.workspaces[0]).toMatchObject({ status: 'skipped' });
      expect(mockBuildEmptyReleaseEntry).not.toHaveBeenCalled();
      // No CHANGELOG.md write for the skipped workspace.
      const changelogWrites = mockWriteFileSync.mock.calls.filter(
        (call: unknown[]) => call[0] === 'packages/arrays/CHANGELOG.md',
      );
      expect(changelogWrites).toHaveLength(0);
    });

    it('returns the tag and changelog path without writing either', () => {
      stubEmptyRange();

      const result = releasePrepareMono(
        singleWorkspaceConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }),
        { force: true },
      );

      expect(result.tags).toStrictEqual(['arrays-v1.0.1']);
      const workspace = result.workspaces[0];
      assert(workspace?.status === 'released', 'expected released');
      expect(workspace.changelogFiles).toStrictEqual(['packages/arrays/CHANGELOG.md']);

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
            changelogPaths: ['packages/arrays'],
            paths: ['packages/arrays/**'],
          },
          {
            dir: 'strings',
            name: '@test/strings',
            tagPrefix: 'strings-v',
            workspacePath: 'packages/strings',
            isPublishable: true,
            packageFiles: ['packages/strings/package.json'],
            changelogPaths: ['packages/strings'],
            paths: ['packages/strings/**'],
          },
          {
            dir: 'numbers',
            name: '@test/numbers',
            tagPrefix: 'numbers-v',
            workspacePath: 'packages/numbers',
            isPublishable: true,
            packageFiles: ['packages/numbers/package.json'],
            changelogPaths: ['packages/numbers'],
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

      releasePrepareMono(config, { force: true });

      // Three workspaces, all empty-range, all forced: each reads its history once, and each changelog
      // comes from the synthetic entry.
      expect(listReadOptions()).toStrictEqual([
        { tagPrefixes: ['arrays-v'], paths: ['packages/arrays/**'] },
        { tagPrefixes: ['strings-v'], paths: ['packages/strings/**'] },
        { tagPrefixes: ['numbers-v'], paths: ['packages/numbers/**'] },
      ]);
      expect(mockBuildEmptyReleaseEntry).toHaveBeenCalledTimes(3);
    });
  });

  describe('changelogJson.enabled gating', () => {
    /** Helper config with one workspace and a feat commit since v1.0.0. */
    function singleWorkspaceConfig(overrides?: Partial<MonorepoReleaseConfig>): MonorepoReleaseConfig {
      const workspace: WorkspaceConfig = {
        dir: 'arrays',
        name: '@test/arrays',
        tagPrefix: 'arrays-v',
        workspacePath: 'packages/arrays',
        isPublishable: true,
        packageFiles: ['packages/arrays/package.json'],
        changelogPaths: ['packages/arrays'],
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

    it('plans no changelog.json write when changelogJson.enabled is false', () => {
      stubFeatCommit();

      releasePrepareMono(
        singleWorkspaceConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: false } }),
        {},
      );

      expect(mockMergeChangelogEntriesWithDisk).toHaveBeenCalledTimes(1);
    });

    it('plans a changelog.json write when changelogJson.enabled is true', () => {
      stubFeatCommit();

      const plan = releasePrepareMono(
        singleWorkspaceConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }),
        {},
      );

      expect(mockRenderChangelogJson).toHaveBeenCalledTimes(1);
      expect(plan.writes.map((write) => write.path)).toContain('packages/arrays/.meta/changelog.json');
    });
  });

  describe('opportunistic hint when baseline is missing', () => {
    /** Configure mocks for a single workspace with no baseline tag and a commit that calls for a minor bump. */
    function setupNoBaseline(tagListOutput: string[]): void {
      stubHistory({ commits: [['feat: add', 'abc']], bump: 'minor' });
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'tag' && args[1] === '--list') {
          return tagListOutput.join('\n') + (tagListOutput.length > 0 ? '\n' : '');
        }
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));
    }

    it('emits a hint when no baseline + candidate tags exist + no legacyIdentities', () => {
      const config = makeConfig({
        workspaces: [
          {
            dir: 'core',
            name: '@test/core',
            tagPrefix: 'nmr-core-v',
            workspacePath: 'packages/core',
            isPublishable: true,
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
          },
        ],
      });
      setupNoBaseline(['core-v0.2.7', 'core-v0.2.8']);
      using capture = captureStdio();

      releasePrepareMono(config, {});

      expect(capture.stderrChunks).toHaveLength(1);
      const message = capture.stderrChunks[0] ?? '';
      expect(message).toContain("no baseline tag found for core under 'nmr-core-v'");
      expect(message).toContain('candidate-shaped tags');
      expect(message).toContain('core-v0.2.7');
      expect(message).toContain('show-tag-prefixes');
    });

    it('suppresses the hint when legacyIdentities is non-empty', () => {
      const config = makeConfig({
        workspaces: [
          {
            dir: 'core',
            name: '@test/core',
            tagPrefix: 'nmr-core-v',
            workspacePath: 'packages/core',
            isPublishable: true,
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
            legacyIdentities: [{ name: '@old-scope/core', tagPrefix: 'core-v' }],
          },
        ],
      });
      setupNoBaseline(['core-v0.2.7']);
      using capture = captureStdio();

      releasePrepareMono(config, {});

      expect(capture.stderrChunks).toHaveLength(0);
    });

    it('suppresses the hint when no candidate-shaped tags exist', () => {
      const config = makeConfig({
        workspaces: [
          {
            dir: 'core',
            name: '@test/core',
            tagPrefix: 'nmr-core-v',
            workspacePath: 'packages/core',
            isPublishable: true,
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
          },
        ],
      });
      setupNoBaseline([]);
      using capture = captureStdio();

      releasePrepareMono(config, {});

      expect(capture.stderrChunks).toHaveLength(0);
    });

    it("treats sibling workspaces' derived prefixes as known (not undeclared candidates)", () => {
      // Regression: previously `maybeEmitBaselineHint` passed only `[workspace.tagPrefix]` as the
      // known-prefix set, so sibling workspaces' tags surfaced as "undeclared candidates" and
      // fired spurious hints in multi-workspace repos. The hint must NOT fire when the only
      // candidate-shaped tags in the repo belong to other configured workspaces.
      const config = makeConfig({
        workspaces: [
          {
            dir: 'core',
            name: '@test/core',
            tagPrefix: 'nmr-core-v',
            workspacePath: 'packages/core',
            isPublishable: true,
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
          },
          {
            dir: 'arrays',
            name: '@test/arrays',
            tagPrefix: 'node-monorepo-arrays-v',
            workspacePath: 'packages/arrays',
            isPublishable: true,
            packageFiles: ['packages/arrays/package.json'],
            changelogPaths: ['packages/arrays'],
            paths: ['packages/arrays/**'],
          },
        ],
      });
      // Only tags in the repo belong to the sibling `arrays` workspace. `core` has no baseline.
      setupNoBaseline(['node-monorepo-arrays-v1.0.0', 'node-monorepo-arrays-v1.1.0']);
      using capture = captureStdio();

      releasePrepareMono(config, {});

      expect(capture.stderrChunks).toHaveLength(0);
    });

    it("treats sibling workspaces' declared legacyIdentities as known", () => {
      // Also a regression case: when a sibling workspace declares its own legacy prefixes, those
      // must not show up as undeclared candidates when another workspace has no baseline.
      const config = makeConfig({
        workspaces: [
          {
            dir: 'core',
            name: '@test/core',
            tagPrefix: 'nmr-core-v',
            workspacePath: 'packages/core',
            isPublishable: true,
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
          },
          {
            dir: 'arrays',
            name: '@test/arrays',
            tagPrefix: 'node-monorepo-arrays-v',
            workspacePath: 'packages/arrays',
            isPublishable: true,
            packageFiles: ['packages/arrays/package.json'],
            changelogPaths: ['packages/arrays'],
            paths: ['packages/arrays/**'],
            legacyIdentities: [{ name: '@old-scope/arrays', tagPrefix: 'arrays-v' }],
          },
        ],
      });
      setupNoBaseline(['arrays-v0.5.0', 'arrays-v0.6.0']);
      using capture = captureStdio();

      releasePrepareMono(config, {});

      expect(capture.stderrChunks).toHaveLength(0);
    });

    it('prints at most one hint per prepare run even with multiple triggering workspaces', () => {
      const config = makeConfig({
        workspaces: [
          {
            dir: 'core',
            name: '@test/core',
            tagPrefix: 'nmr-core-v',
            workspacePath: 'packages/core',
            isPublishable: true,
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
          },
          {
            dir: 'arrays',
            name: '@test/arrays',
            tagPrefix: 'node-monorepo-arrays-v',
            workspacePath: 'packages/arrays',
            isPublishable: true,
            packageFiles: ['packages/arrays/package.json'],
            changelogPaths: ['packages/arrays'],
            paths: ['packages/arrays/**'],
          },
        ],
      });
      setupNoBaseline(['core-v0.2.7', 'arrays-v0.1.0']);
      using capture = captureStdio();

      releasePrepareMono(config, {});

      expect(capture.stderrChunks).toHaveLength(1);
    });
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
            changelogPaths: ['packages/arrays'],
            paths: ['packages/arrays/**'],
          },
        ],
      });
      stubHistory({ previousTag: 'arrays-v1.0.0', commits: [['feat: add', 'abc']], bump: 'minor' });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      const result = releasePrepareMono(config, {});

      expect(result.project).toBeUndefined();
      // The arrays workspace was bumped; no project tag was added.
      expect(result.tags).toStrictEqual(['arrays-v1.1.0']);
    });

    it('runs the project release when config.project is defined and surfaces it on result.project', () => {
      const config = makeConfig({
        workspaces: [
          {
            dir: 'arrays',
            name: '@test/arrays',
            tagPrefix: 'arrays-v',
            workspacePath: 'packages/arrays',
            isPublishable: true,
            packageFiles: ['packages/arrays/package.json'],
            changelogPaths: ['packages/arrays'],
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

      const result = releasePrepareMono(config, {});

      expect(result.project).toBeDefined();
      const project = result.project;
      assert(project?.status === 'released', 'expected released project');
      expect(project.tag).toBe('v0.10.0');
      expect(project.releaseType).toBe('minor');
      expect(result.tags).toContain('arrays-v1.1.0');
      expect(result.tags).toContain('v0.10.0');
      // The workspace and the project each read their history once.
      expect(listReadOptions()).toStrictEqual([
        { tagPrefixes: ['arrays-v'], paths: ['packages/arrays/**'] },
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
            changelogPaths: ['packages/arrays'],
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

      const result = releasePrepareMono(config, { only: ['arrays'] });

      expect(result.project).toBeUndefined();
      expect(result.tags).toContain('arrays-v1.1.0');
      expect(result.tags).not.toContain('v0.10.0');
      expect(result.warnings?.join('\n')).toContain('Project release skipped');
      expect(result.warnings?.join('\n')).toContain('arrays');
      expect(listReadOptions()).toStrictEqual([{ tagPrefixes: ['arrays-v'], paths: ['packages/arrays/**'] }]);
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
            changelogPaths: ['packages/arrays'],
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

      const result = releasePrepareMono(config, {});

      const formatCall = result.formatCommand?.command;
      expect(formatCall).toContain('packages/arrays/package.json');
      expect(formatCall).toContain('./package.json');
      expect(formatCall).toContain('CHANGELOG.md');
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
            changelogPaths: ['packages/arrays'],
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

      releasePrepareMono(config, { withReleaseNotes: true });

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

      releasePrepareMono(config, {});

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
            changelogPaths: ['packages/arrays'],
            paths: ['packages/arrays/**'],
          },
        ],
      });
      stubHistory({ previousTag: 'arrays-v1.0.0', commits: [['feat: add utility', 'abc123']], bump: 'minor' });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));
      using silent = silenceConsole(['warn']);

      const plan = releasePrepareMono(config, { withReleaseNotes: true });

      expect(mockPlanReleaseNotesPreviews).not.toHaveBeenCalled();
      expect(plan.warnings).toStrictEqual([
        '--with-release-notes requires changelogJson.enabled; skipping preview generation',
      ]);
      expect(silent.warn).not.toHaveBeenCalled();
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
            changelogPaths: ['packages/arrays'],
            paths: ['packages/arrays/**'],
          },
        ],
        changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true },
      });
      stubHistory({ previousTag: 'arrays-v1.0.0' });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/arrays', version: '1.0.0' }));

      releasePrepareMono(config, { withReleaseNotes: true });

      expect(mockPlanReleaseNotesPreviews).not.toHaveBeenCalled();
    });

    it('carries the planned preview files into the plan', () => {
      const config = setupArraysWithFeat();

      mockPlanReleaseNotesPreviews.mockReturnValue({
        writes: [{ path: 'packages/arrays/docs/RELEASE_NOTES.v1.1.0.md', content: '# Notes\n' }],
        warnings: [],
      });

      const plan = releasePrepareMono(config, { withReleaseNotes: true });

      expect(plannedContent(plan, 'packages/arrays/docs/RELEASE_NOTES.v1.1.0.md')).toBe('# Notes\n');
      expect(plan.workspaces[0]).toMatchObject({
        previewFiles: ['packages/arrays/docs/RELEASE_NOTES.v1.1.0.md'],
      });
    });

    it('invokes planReleaseNotesPreviews for both direct-bumped and propagation-only workspaces', () => {
      // Mirrors the `dependency propagation` setup: core is bumped directly (feat commit), and
      // app is bumped only through propagation. Both branches of `generateWorkspaceChangelogs`
      // must reach `maybeWritePreviews` so previews are written for each workspace.
      const config = makeConfig({
        workspaces: [
          {
            dir: 'core',
            name: '@test/core',
            tagPrefix: 'core-v',
            workspacePath: 'packages/core',
            isPublishable: true,
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
          },
          {
            dir: 'app',
            name: '@test/app',
            tagPrefix: 'app-v',
            workspacePath: 'packages/app',
            isPublishable: true,
            packageFiles: ['packages/app/package.json'],
            changelogPaths: ['packages/app'],
            paths: ['packages/app/**'],
          },
        ],
        changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true },
      });

      stubHistoryByPrefix({
        'core-v': { previousTag: 'core-v1.0.0', commits: [['feat: add utility', 'abc123']], bump: 'minor' },
        'app-v': { previousTag: 'app-v2.0.0' },
      });
      mockExecFileSync.mockReturnValue('[]');
      mockReadFileSync.mockImplementation((filePath: string) => {
        if (typeof filePath === 'string' && filePath.includes('core')) {
          return JSON.stringify({ name: '@test/core', version: '1.0.0' });
        }
        return JSON.stringify({
          name: '@test/app',
          version: '2.0.0',
          dependencies: { '@test/core': 'workspace:*' },
        });
      });
      mockExistsSync.mockReturnValue(false);

      releasePrepareMono(config, { withReleaseNotes: true });

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
            changelogPaths: ['packages/arrays'],
            paths: ['packages/arrays/**'],
          },
        ],
        ...overrides,
      });
    }

    it("wraps a Phase 1 (history-read) throw with the workspace's release-stage label", async () => {
      const config = makeArraysConfig();
      // Make `readReleaseHistory` throw, which exercises the Phase 1 wrap inside `determineDirectBumps`.
      const underlying = new Error('git rev-list failed: not a git repo');
      mockReadReleaseHistory.mockImplementation(() => {
        throw underlying;
      });

      const wrapped = await captureError(() => releasePrepareMono(config, {}));

      expect(wrapped.message).toMatch(/^workspace 'arrays' release stage: .*git rev-list failed: not a git repo$/);
      // `cause` is preserved through the chain — at minimum, an Error instance.
      expect(wrapped.cause).toBeInstanceOf(Error);
    });

    it("wraps a Phase 3 (executeWorkspaceRelease) throw with the workspace's release-stage label", async () => {
      const config = makeArraysConfig();
      // Phase 1 succeeds. `renderChangelogMarkdown` (which `executeWorkspaceRelease` reaches)
      // throws — this exercises the Phase 3 wrap inside `executeReleaseSet`.
      const underlying = new Error('markdown render failed');
      stubHistory({ previousTag: 'arrays-v1.0.0', commits: [['feat: add', 'abc123']], bump: 'minor' });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));
      mockRenderChangelogMarkdown.mockImplementationOnce(() => {
        throw underlying;
      });

      const wrapped = await captureError(() => releasePrepareMono(config, {}));

      expect(wrapped.message).toMatch(/^workspace 'arrays' release stage: .*markdown render failed$/);
      // `cause` is preserved through the chain — at minimum, an Error instance.
      expect(wrapped.cause).toBeInstanceOf(Error);
    });

    it('wraps a project-stage throw with the project release-stage label', async () => {
      const config = makeArraysConfig({ project: { paths: ['packages/arrays/**'], tagPrefix: 'v' } });
      // The workspace stage's read succeeds; the project stage's read throws.
      const underlying = new Error('git log failed on root');
      mockReadFileSync.mockImplementation((filePath: string) => {
        if (filePath === './package.json') return JSON.stringify({ name: 'root', version: '0.9.0' });
        return JSON.stringify({ version: '1.0.0' });
      });
      mockReadReleaseHistory
        .mockReturnValueOnce(
          makeReleaseHistory({ previousTag: 'arrays-v1.0.0', commits: [['feat: ship', 'abc123']], bump: 'minor' }),
        )
        .mockImplementationOnce(() => {
          throw underlying;
        });

      const wrapped = await captureError(() => releasePrepareMono(config, {}));

      expect(wrapped.message).toMatch(/^project release stage: .*git log failed on root$/);
      expect(wrapped.cause).toBeInstanceOf(Error);
    });
  });

  describe('changelog diagnostics', () => {
    function makeWorkspace(overrides?: Partial<WorkspaceConfig>): WorkspaceConfig {
      return {
        dir: 'arrays',
        name: '@test/arrays',
        tagPrefix: 'arrays-v',
        workspacePath: 'packages/arrays',
        isPublishable: true,
        packageFiles: ['packages/arrays/package.json'],
        changelogPaths: ['packages/arrays'],
        paths: ['packages/arrays/**'],
        ...overrides,
      };
    }

    const malformedBlock: MalformedChangeRecordBlock = {
      commitHash: 'aaa1111',
      commitSubject: 'Squash',
      reason: '`entries` is not a list',
    };
    const undeclared: UndeclaredEntryType = {
      commitHash: 'bbb2222',
      commitSubject: 'Merge PR',
      entryPosition: 2,
      type: 'chore',
    };
    const prefixViolation: PolicyViolation = {
      commitHash: 'def5678',
      commitSubject: 'internal!: refactor cache',
      type: 'internal',
      surface: 'prefix',
    };
    const entryViolation: PolicyViolation = {
      commitHash: 'bbb2222',
      commitSubject: 'Merge PR',
      type: 'drop',
      surface: 'entry',
      entryPosition: 1,
    };

    it('reads each history with the run config, whose breaking policies decide the violations', () => {
      const config = makeConfig({ workspaces: [makeWorkspace()], breakingPolicies: {} });
      stubHistory({ previousTag: 'arrays-v1.0.0', commits: [['feat: add', 'abc1234']], bump: 'minor' });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      releasePrepareMono(config, {});

      expect(mockReadReleaseHistory).toHaveBeenCalledExactlyOnceWith(config, expect.any(Object));
    });

    it('omits every diagnostic list that the history leaves empty', () => {
      const config = makeConfig({ workspaces: [makeWorkspace()] });
      stubHistory({ previousTag: 'arrays-v1.0.0', commits: [['feat!: drop legacy export', 'abc1234']], bump: 'major' });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      const result = releasePrepareMono(config, {});

      expect(result.workspaces[0]?.status).toBe('released');
      expect(result.workspaces[0]?.malformedBlocks).toBeUndefined();
      expect(result.workspaces[0]?.policyViolations).toBeUndefined();
      expect(result.workspaces[0]?.undeclaredEntryTypes).toBeUndefined();
    });

    it("attaches the history's diagnostics to a released result", () => {
      const config = makeConfig({ workspaces: [makeWorkspace()] });
      stubHistory({
        previousTag: 'arrays-v1.0.0',
        commits: [['internal!: refactor cache', 'def5678']],
        bump: 'patch',
        diagnostics: {
          malformedBlocks: [malformedBlock],
          policyViolations: [prefixViolation, entryViolation],
          undeclaredEntryTypes: [undeclared],
        },
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      const result = releasePrepareMono(config, {});

      expect(result.workspaces[0]).toMatchObject({
        status: 'released',
        malformedBlocks: [malformedBlock],
        undeclaredEntryTypes: [undeclared],
        policyViolations: [prefixViolation, entryViolation],
      });
    });

    it("attaches the history's diagnostics to a skipped result", () => {
      const config = makeConfig({ workspaces: [makeWorkspace()] });
      stubHistory({
        previousTag: 'arrays-v1.0.0',
        commits: [['Merge PR', 'bbb2222']],
        diagnostics: {
          malformedBlocks: [malformedBlock],
          policyViolations: [entryViolation],
          undeclaredEntryTypes: [undeclared],
        },
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      const result = releasePrepareMono(config, {});

      expect(result.workspaces[0]).toMatchObject({
        status: 'skipped',
        malformedBlocks: [malformedBlock],
        undeclaredEntryTypes: [undeclared],
        policyViolations: [entryViolation],
      });
    });

    it('attaches diagnostics only to the workspace whose history reported them', () => {
      const cleanWorkspace = makeWorkspace({
        dir: 'core',
        name: '@test/core',
        tagPrefix: 'core-v',
        workspacePath: 'packages/core',
        packageFiles: ['packages/core/package.json'],
        changelogPaths: ['packages/core'],
        paths: ['packages/core/**'],
      });
      const config = makeConfig({ workspaces: [makeWorkspace(), cleanWorkspace] });
      stubHistoryByPrefix({
        'arrays-v': {
          previousTag: 'arrays-v1.0.0',
          commits: [['internal!: refactor cache', 'def5678']],
          bump: 'patch',
          diagnostics: { policyViolations: [prefixViolation] },
        },
        'core-v': { previousTag: 'core-v1.0.0', commits: [['feat: add helper', 'aaa1111']], bump: 'minor' },
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      const result = releasePrepareMono(config, {});

      const arraysResult = result.workspaces.find((w) => w.name === 'arrays');
      const coreResult = result.workspaces.find((w) => w.name === 'core');
      expect(arraysResult?.policyViolations).toStrictEqual([prefixViolation]);
      expect(coreResult?.policyViolations).toBeUndefined();
    });
  });

  describe('editorial overrides wiring', () => {
    // Integration coverage for the per-scope override flow. Helper-level tests in
    // `changelogOverrides.unit.test.ts` cover the per-helper behavior; this group asserts the
    // orchestrator's threading — that warnings produced by `applyWorkspaceOverrides` reach the
    // final `PrepareResult.warnings` array.
    it('surfaces a per-workspace stale-key warning on PrepareResult.warnings', () => {
      const config = makeConfig({
        workspaces: [
          {
            dir: 'arrays',
            name: '@test/arrays',
            tagPrefix: 'arrays-v',
            workspacePath: 'packages/arrays',
            isPublishable: true,
            packageFiles: ['packages/arrays/package.json'],
            changelogPaths: ['packages/arrays'],
            paths: ['packages/arrays/**'],
          },
        ],
      });

      // Stub the history: one commit since the previous tag, whose item carries a known hash that
      // does NOT match the override key the workspace file declares; the override is therefore
      // stale and the workspace-tier rule warns immediately.
      stubHistory({
        previousTag: 'arrays-v1.0.0',
        commits: [['feat: add utility', 'realcommithash']],
        bump: 'minor',
        sections: [
          { title: 'Features', audience: 'all', items: [{ description: 'Add utility', hash: 'realcommithash' }] },
        ],
      });

      // Surface the workspace's `.meta/changelog-overrides.json` to the loader. Every other
      // existsSync probe (e.g., for prettier config) returns false.
      const workspaceOverridePath = 'packages/arrays/.meta/changelog-overrides.json';
      mockExistsSync.mockImplementation((path: string) => path.endsWith(workspaceOverridePath));
      mockReadFileSync.mockImplementation((path: string) => {
        if (typeof path === 'string' && path.endsWith(workspaceOverridePath)) {
          return JSON.stringify({ deadaaa: { audience: 'skip' } });
        }
        return JSON.stringify({ name: '@test/arrays', version: '1.0.0' });
      });

      const result = releasePrepareMono(config, {});

      // The per-workspace stale-key warning must surface on PrepareResult.warnings — proves
      // `applyWorkspaceOverrides`'s `overrideWarnings.push(...)` is correctly threaded through
      // the orchestrator's final aggregation.
      expect(result.warnings).toBeDefined();
      const warnings = result.warnings ?? [];
      expect(warnings.some((message) => message.includes("'deadaaa'"))).toBe(true);
      expect(warnings.some((message) => /stale reference/.test(message))).toBe(true);
    });
  });
});

/** Content the plan intends to write to `path`, or undefined when the plan does not write it. */
function plannedContent(
  plan: { writes: readonly { path: string; content: string }[] },
  path: string,
): string | undefined {
  return plan.writes.find((write) => write.path === path)?.content;
}

/** Stubs the release history that `readReleaseHistory` returns for every scope. */
function stubHistory(stub: ReleaseHistoryStub): void {
  mockReadReleaseHistory.mockReturnValue(makeReleaseHistory(stub));
}

/** Stubs the release history per scope, keyed by a tag prefix that `readReleaseHistory` receives. */
function stubHistoryByPrefix(stubs: Record<string, ReleaseHistoryStub>): void {
  mockReadReleaseHistory.mockImplementation((_config: unknown, options: { tagPrefixes: readonly string[] }) => {
    const stub = options.tagPrefixes.map((prefix) => stubs[prefix]).find((found) => found !== undefined);
    return makeReleaseHistory(stub);
  });
}

/** Returns the options of every `readReleaseHistory` call, in call order. */
function listReadOptions(): unknown[] {
  return mockReadReleaseHistory.mock.calls.map((call: unknown[]) => call[1]);
}
