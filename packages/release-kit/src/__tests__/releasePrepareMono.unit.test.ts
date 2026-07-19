import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());
const mockExecSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockHasPrettierConfig = vi.hoisted(() => vi.fn());
const mockWriteReleaseNotesPreviews = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
  execSync: mockExecSync,
}));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

vi.mock('../resolveCliffConfigPath.ts', () => ({
  resolveCliffConfigPath: () => 'cliff.toml',
}));

vi.mock('../hasPrettierConfig.ts', () => ({
  hasPrettierConfig: mockHasPrettierConfig,
}));

vi.mock('../writeReleaseNotesPreviews.ts', () => ({
  writeReleaseNotesPreviews: mockWriteReleaseNotesPreviews,
}));

// Stub out the new helpers for tests in this file that exercise the
// `changelogJson.enabled: true` path. The default stubs return deterministic values without
// invoking git-cliff or touching the filesystem.
const mockBuildChangelogEntries = vi.hoisted(() => vi.fn());
const mockBuildSyntheticChangelogEntry = vi.hoisted(() => vi.fn());
const mockBuildEmptyReleaseEntry = vi.hoisted(() => vi.fn());
const mockUpsertChangelogJson = vi.hoisted(() => vi.fn());
const mockUpsertChangelogJsonAndReturn = vi.hoisted(() => vi.fn());
const mockMergeChangelogEntriesWithDisk = vi.hoisted(() => vi.fn());
const mockWriteChangelogMarkdown = vi.hoisted(() => vi.fn());

vi.mock('../buildChangelogEntries.ts', () => ({
  buildChangelogEntries: mockBuildChangelogEntries,
}));

vi.mock('../buildSyntheticChangelogEntry.ts', () => ({
  buildSyntheticChangelogEntry: mockBuildSyntheticChangelogEntry,
}));

vi.mock('../buildEmptyReleaseEntry.ts', () => ({
  buildEmptyReleaseEntry: mockBuildEmptyReleaseEntry,
}));

vi.mock('../changelogJsonFile.ts', () => ({
  resolveChangelogJsonPath: (config: { changelogJson: { outputPath: string } }, changelogPath: string): string =>
    `${changelogPath}/${config.changelogJson.outputPath}`,
  writeChangelogJson: vi.fn(),
  upsertChangelogJson: mockUpsertChangelogJson,
  upsertChangelogJsonAndReturn: mockUpsertChangelogJsonAndReturn,
  mergeChangelogEntriesWithDisk: mockMergeChangelogEntriesWithDisk,
}));

vi.mock('../renderChangelogMarkdown.ts', () => ({
  writeChangelogMarkdown: mockWriteChangelogMarkdown,
}));

import {
  DEFAULT_BREAKING_POLICIES,
  DEFAULT_CHANGELOG_JSON_CONFIG,
  DEFAULT_RELEASE_NOTES_CONFIG,
  DEFAULT_WORK_TYPES,
} from '../defaults.ts';
import { releasePrepareMono } from '../releasePrepareMono.ts';
import type { MonorepoReleaseConfig, WorkspaceConfig, WorkTypeConfig } from '../types.ts';

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

/**
 * Count how many invocations of `buildChangelogEntries` (the cliff `--context` source) were
 * recorded. Replaces the previous `npx git-cliff --output` shape — markdown rendering is now
 * in-process, and `buildChangelogEntries` is the single observable cliff entry point.
 */
function countCliffCalls(): number {
  return mockBuildChangelogEntries.mock.calls.length;
}

/**
 * Return the args of the first `buildChangelogEntries` invocation as an array of cliff-style
 * flag-value pairs so existing assertions (`expect(cliffArgs).toContain('--include-path')`,
 * etc.) continue to work without per-test rewrites. Includes synthetic `--output` and
 * `<changelog>/CHANGELOG.md` entries derived from the renderer's first call to keep
 * pre-pivot tests passing — the markdown writer is the new owner of those concepts.
 */
function findCliffCallArgs(): readonly unknown[] {
  const buildCall = mockBuildChangelogEntries.mock.calls[0];
  if (buildCall === undefined) {
    throw new Error('buildChangelogEntries was not called');
  }
  const tag = buildCall[1];
  const options = buildCall[2] ?? {};
  const renderCall = mockWriteChangelogMarkdown.mock.calls[0]?.[0];
  const args: unknown[] = ['git-cliff', '--config', '<resolved>'];
  if (typeof tag === 'string') {
    args.push('--tag', tag);
  }
  if (isCliffOptions(options)) {
    if (typeof options.tagPattern === 'string') {
      args.push('--tag-pattern', options.tagPattern);
    }
    for (const includePath of options.includePaths ?? []) {
      args.push('--include-path', includePath);
    }
  }
  if (isRenderCallArg(renderCall) && typeof renderCall.changelogPath === 'string') {
    args.push('--output', `${renderCall.changelogPath}/CHANGELOG.md`);
  }
  return args;
}

/** Type guard for the third positional argument passed to `buildChangelogEntries`. */
function isCliffOptions(value: unknown): value is { tagPattern?: string; includePaths?: string[] } {
  return typeof value === 'object' && value !== null;
}

/** Type guard for the first positional argument passed to `writeChangelogMarkdown`. */
function isRenderCallArg(value: unknown): value is { changelogPath?: string; dryRun?: boolean } {
  return typeof value === 'object' && value !== null;
}

/** Count how many cache-refresh warmup calls occurred (`npx --yes git-cliff --version`). */
function countCacheRefreshCalls(): number {
  return mockExecFileSync.mock.calls.filter(
    (call: unknown[]) =>
      call[0] === 'npx' &&
      Array.isArray(call[1]) &&
      call[1].includes('git-cliff') &&
      call[1].includes('--version') &&
      !call[1].includes('--config'),
  ).length;
}

/**
 * Return the cross-mock invocation order of the first cache-refresh call, or `+Infinity` if
 * none. Sentinel chosen so `firstCacheRefreshCallIndex() < firstCliffWorkCallIndex()` only
 * passes when both are present.
 */
function firstCacheRefreshCallIndex(): number {
  for (let index = 0; index < mockExecFileSync.mock.calls.length; index += 1) {
    const call = mockExecFileSync.mock.calls[index];
    if (call === undefined) continue;
    if (
      call[0] === 'npx' &&
      Array.isArray(call[1]) &&
      call[1].includes('git-cliff') &&
      call[1].includes('--version') &&
      !call[1].includes('--config')
    ) {
      return mockExecFileSync.mock.invocationCallOrder[index] ?? Infinity;
    }
  }
  return Infinity;
}

/**
 * Return the cross-mock invocation order of the first cliff *work* call, or `-Infinity`
 * if none. After the SSOT pivot, `buildChangelogEntries` is the in-package entry point
 * that issues cliff `--context` work, so its first invocation marks the start of cliff
 * work for ordering assertions.
 */
function firstCliffWorkCallIndex(): number {
  return mockBuildChangelogEntries.mock.invocationCallOrder[0] ?? Number.NEGATIVE_INFINITY;
}

describe(releasePrepareMono, () => {
  beforeEach(() => {
    // Default: pretend buildChangelogEntries returned no entries, the synthetic constructor
    // returned an empty stub entry, and upsertChangelogJson echoed the file path. Individual
    // tests can override if needed.
    mockBuildChangelogEntries.mockReturnValue([]);
    mockBuildSyntheticChangelogEntry.mockReturnValue({ version: '0.0.0', date: '2024-01-01', sections: [] });
    mockBuildEmptyReleaseEntry.mockReturnValue({
      version: '0.0.0',
      date: '2024-01-01',
      sections: [{ title: 'Notes', audience: 'dev', items: [{ description: 'Forced version bump.' }] }],
    });
    mockUpsertChangelogJson.mockImplementation((filePath: string) => filePath);
    mockUpsertChangelogJsonAndReturn.mockImplementation((_filePath: string, entries: unknown[]) => entries);
    mockMergeChangelogEntriesWithDisk.mockImplementation((_filePath: string, entries: unknown[]) => entries);
    mockWriteChangelogMarkdown.mockImplementation(
      (args: { changelogPath: string }) => `${args.changelogPath}/CHANGELOG.md`,
    );
  });

  afterEach(() => {
    mockExecFileSync.mockReset();
    mockExecSync.mockReset();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockHasPrettierConfig.mockReset();
    mockWriteReleaseNotesPreviews.mockReset();
    mockBuildChangelogEntries.mockReset();
    mockBuildSyntheticChangelogEntry.mockReset();
    mockBuildEmptyReleaseEntry.mockReset();
    mockUpsertChangelogJson.mockReset();
    mockUpsertChangelogJsonAndReturn.mockReset();
    mockMergeChangelogEntriesWithDisk.mockReset();
    mockWriteChangelogMarkdown.mockReset();
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

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'arrays-v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return 'feat: add utility\u{1F}abc123';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, { dryRun: false });

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

    // Verify bumpAllVersions wrote a new version
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      'packages/arrays/package.json',
      expect.stringContaining('"version": "1.1.0"'),
      'utf8',
    );

    // Verify git-cliff was called for the workspace's changelog path
    const cliffArgs = findCliffCallArgs();
    expect(cliffArgs).toContain('--output');
    expect(cliffArgs).toContain('packages/arrays/CHANGELOG.md');
    expect(cliffArgs).toContain('--include-path');
    expect(cliffArgs).toContain('packages/arrays/**');
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

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'arrays-v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return '';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/arrays', version: '1.0.0' }));

    const result = releasePrepareMono(config, { dryRun: false });

    expect(result.tags).toStrictEqual([]);
    expect(result.workspaces).toHaveLength(1);
    expect(result.workspaces[0]).toMatchObject({
      name: 'arrays',
      status: 'skipped',
      commitCount: 0,
      parsedCommitCount: 0,
    });
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(countCliffCalls()).toBe(0);
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

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        const matchArg = args.find((a: string) => a.startsWith('--match='));
        if (matchArg?.includes('arrays-v')) {
          return 'arrays-v1.0.0\n';
        }
        if (matchArg?.includes('strings-v')) {
          return 'strings-v2.0.0\n';
        }
      }
      if (cmd === 'git' && args[0] === 'log') {
        const hasArraysPath = args.includes('packages/arrays/**');
        if (hasArraysPath) {
          return 'fix: fix array bug\u{1F}def456';
        }
        return '';
      }
      return '';
    });

    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, { dryRun: false });

    expect(result.tags).toStrictEqual(['arrays-v1.0.1']);
    expect(result.workspaces).toHaveLength(2);
    expect(result.workspaces[0]).toMatchObject({ name: 'arrays', status: 'released' });
    expect(result.workspaces[1]).toMatchObject({ name: 'strings', status: 'skipped' });

    // Only arrays package.json should be written
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    expect(mockWriteFileSync).toHaveBeenCalledWith('packages/arrays/package.json', expect.any(String), 'utf8');

    // Only arrays changelog should be generated
    expect(countCliffCalls()).toBe(1);
    const cliffArgs = findCliffCallArgs();
    expect(cliffArgs).toContain('packages/arrays/CHANGELOG.md');
  });

  it('does not write files or run formatCommand when dryRun is true', () => {
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

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'arrays-v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return 'feat: add feature\u{1F}abc123';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, { dryRun: true });

    expect(result.tags).toStrictEqual(['arrays-v1.1.0']);
    expect(result.dryRun).toBe(true);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    // After the SSOT pivot, `buildChangelogEntries` is invoked even under dry-run (it has no
    // file-write side effects); only the per-changelog-path markdown writer respects the flag.
    expect(countCliffCalls()).toBe(1);
    const writeArgs = mockWriteChangelogMarkdown.mock.calls[0]?.[0];
    expect(isRenderCallArg(writeArgs) ? writeArgs.dryRun : undefined).toBe(true);
    expect(mockExecSync).not.toHaveBeenCalled();

    // Verify the format command is captured but not executed
    expect(result.formatCommand).toMatchObject({
      command: 'npx prettier --write packages/arrays/package.json packages/arrays/CHANGELOG.md',
      executed: false,
    });
  });

  it('runs formatCommand once after all workspaces are processed', () => {
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

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        const matchArg = args.find((a: string) => a.startsWith('--match='));
        if (matchArg?.includes('arrays-v')) return 'arrays-v1.0.0\n';
        if (matchArg?.includes('strings-v')) return 'strings-v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return 'feat: add feature\u{1F}abc123';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    releasePrepareMono(config, { dryRun: false });

    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(mockExecSync).toHaveBeenCalledWith(
      'npx prettier --write packages/arrays/package.json packages/arrays/CHANGELOG.md packages/strings/package.json packages/strings/CHANGELOG.md',
      { stdio: 'inherit' },
    );
  });

  it('uses bumpOverride instead of commit-derived bump type', () => {
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

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'arrays-v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return 'fix: small patch\u{1F}abc123';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, { dryRun: false, bumpOverride: 'minor' });

    expect(result.tags).toStrictEqual(['arrays-v1.1.0']);

    // Should use the override (minor) rather than the commit-derived type (patch)
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      'packages/arrays/package.json',
      expect.stringContaining('"version": "1.1.0"'),
      'utf8',
    );

    const cliffArgs = findCliffCallArgs();
    expect(cliffArgs).toContain('--tag');
    expect(cliffArgs).toContain('arrays-v1.1.0');
  });

  it('skips when commits exist but none are bump-worthy and no --force is given', () => {
    // Under the orthogonal-flag model, the per-workspace path no longer applies a patch
    // floor when there are commits but none map to a bump-worthy work type. The pipeline
    // now requires a release signal: a natural bump (parseable bump-worthy commits) OR
    // `--force`. With neither, the workspace skips with the new "No bump-worthy commits"
    // skipReason.
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

    // Return a commit whose type (chore) is not in workTypes (only feat, fix).
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'arrays-v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return 'chore: update deps\u{1F}abc123';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, { dryRun: false });

    expect(result.tags).toStrictEqual([]);
    const workspace = result.workspaces[0];
    expect(workspace).toMatchObject({
      status: 'skipped',
      commitCount: 1,
      parsedCommitCount: 0,
    });
    if (workspace?.status !== 'skipped') throw new Error('expected skipped');
    expect(workspace.skipReason).toContain('No bump-worthy commits for arrays since arrays-v1.0.0');
    expect(workspace.skipReason).toContain('Pass --force to release at patch');
    expect(workspace.unparseableCommits).toStrictEqual([{ message: 'chore: update deps', hash: 'abc123' }]);
  });

  it('falls back to patch when commits exist but none are bump-worthy and --force is set', () => {
    // Row 11 of the behavioral matrix: `--force` alone with commits-but-no-bump-worthy
    // releases at patch. Today the CLI rejected `--force` without `--bump`; with the
    // validation removed, this combination is now a valid invocation.
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

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'arrays-v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return 'chore: update deps\u{1F}abc123';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, { dryRun: false, force: true });

    expect(result.tags).toStrictEqual(['arrays-v1.0.1']);
    expect(result.workspaces[0]).toMatchObject({
      status: 'released',
      commitCount: 1,
      parsedCommitCount: 0,
      releaseType: 'patch',
    });
    expect(result.workspaces[0]?.unparseableCommits).toStrictEqual([{ message: 'chore: update deps', hash: 'abc123' }]);
  });

  it('skips when --bump=X alone is set with commits-but-no-bump-worthy (level chooser, not trigger)', () => {
    // Row 10 of the behavioral matrix: `--bump=X` is now a pure level chooser; it does
    // not trigger a release on its own. With commits that don't parse to a bump-worthy
    // type, the workspace skips even when `--bump=X` is set without `--force`.
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

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'arrays-v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return 'chore: update deps\u{1F}abc123';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, { dryRun: false, bumpOverride: 'minor' });

    expect(result.tags).toStrictEqual([]);
    const workspace = result.workspaces[0];
    expect(workspace).toMatchObject({
      status: 'skipped',
      commitCount: 1,
    });
    if (workspace?.status !== 'skipped') throw new Error('expected skipped');
    expect(workspace.skipReason).toContain('No bump-worthy commits for arrays since arrays-v1.0.0');
  });

  it('falls back to patch when --force is set with no commits (no --bump)', () => {
    // Row 3 of the behavioral matrix: `--force` alone with no commits is now a valid
    // invocation that releases at patch. Today this combination was rejected at the CLI.
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

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'arrays-v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return '';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, { dryRun: false, force: true });

    expect(result.tags).toStrictEqual(['arrays-v1.0.1']);
    const workspace = result.workspaces[0];
    expect(workspace).toMatchObject({
      status: 'released',
      commitCount: 0,
      parsedCommitCount: 0,
      releaseType: 'patch',
    });
    if (workspace?.status !== 'released') throw new Error('expected released');
    expect(workspace.bumpOverride).toBeUndefined();
  });

  it('mixed-sibling case: --force alone uses natural bump for one workspace and patch fallback for another', () => {
    // With `--force` alone (no `--bump`), workspaces with bump-worthy commits use their
    // natural bump (e.g., feat → minor); workspaces without bump-worthy commits fall back
    // to patch. This is the mixed-hygiene operator use case the orthogonal model unlocks.
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

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        const matchArg = args.find((a: string) => a.startsWith('--match='));
        if (matchArg?.includes('arrays-v')) return 'arrays-v1.0.0\n';
        if (matchArg?.includes('strings-v')) return 'strings-v2.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        const hasArraysPath = args.includes('packages/arrays/**');
        if (hasArraysPath) {
          return 'chore: update deps\u{1F}abc123';
        }
        return 'feat: add helper\u{1F}def456';
      }
      return '';
    });
    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('arrays')) return JSON.stringify({ version: '1.0.0' });
      return JSON.stringify({ version: '2.0.0' });
    });

    const result = releasePrepareMono(config, { dryRun: false, force: true });

    // arrays falls back to patch (chore is not bump-worthy); strings uses natural minor (feat).
    expect(result.tags).toStrictEqual(['arrays-v1.0.1', 'strings-v2.1.0']);
    expect(result.workspaces[0]).toMatchObject({ name: 'arrays', status: 'released', releaseType: 'patch' });
    expect(result.workspaces[1]).toMatchObject({ name: 'strings', status: 'released', releaseType: 'minor' });
  });

  it('uses parsed bump type when mix of parseable and unparseable commits exist', () => {
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

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'arrays-v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return 'feat: add utility\u{1F}abc123\nchore: update deps\u{1F}def456';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, { dryRun: false });

    expect(result.workspaces[0]).toMatchObject({
      status: 'released',
      releaseType: 'minor',
      parsedCommitCount: 1,
    });
    expect(result.workspaces[0]?.unparseableCommits).toStrictEqual([{ message: 'chore: update deps', hash: 'def456' }]);
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

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'arrays-v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return '';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, { dryRun: false, force: true, bumpOverride: 'patch' });

    expect(result.tags).toStrictEqual(['arrays-v1.0.1']);
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      'packages/arrays/package.json',
      expect.stringContaining('"version": "1.0.1"'),
      'utf8',
    );
    // Empty-range release: git-cliff is bypassed in favor of the synthetic
    // "Notes / Forced version bump." entry (issue #369).
    expect(countCliffCalls()).toBe(0);
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

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        const matchArg = args.find((a: string) => a.startsWith('--match='));
        if (matchArg?.includes('arrays-v')) return 'arrays-v1.0.0\n';
        if (matchArg?.includes('strings-v')) return 'strings-v2.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        const hasStringsPath = args.includes('packages/strings/**');
        if (hasStringsPath) {
          return 'feat: add string helper\u{1F}abc123';
        }
        return '';
      }
      return '';
    });
    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('arrays')) return JSON.stringify({ version: '1.0.0' });
      return JSON.stringify({ version: '2.0.0' });
    });

    const result = releasePrepareMono(config, { dryRun: false, force: true, bumpOverride: 'patch' });

    // arrays is bumped via --force (0 commits); strings is bumped via commits; both use bumpOverride: 'patch'
    expect(result.tags).toStrictEqual(['arrays-v1.0.1', 'strings-v2.0.1']);
  });

  it('does not write files when force and dryRun are both true', () => {
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

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'arrays-v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return '';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, { dryRun: true, force: true, bumpOverride: 'patch' });

    expect(result.tags).toStrictEqual(['arrays-v1.0.1']);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(countCliffCalls()).toBe(0);
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

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'arrays-v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return '';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/arrays', version: '1.0.0' }));

    const result = releasePrepareMono(config, { dryRun: false });

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

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'arrays-v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return 'feat: add feature\u{1F}abc123';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    releasePrepareMono(config, { dryRun: false });

    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(mockExecSync).toHaveBeenCalledWith(
      'npx prettier --write packages/arrays/package.json packages/arrays/CHANGELOG.md',
      { stdio: 'inherit' },
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

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'arrays-v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return 'feat: add feature\u{1F}abc123';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    releasePrepareMono(config, { dryRun: false });

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

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'arrays-v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return 'feat: add utility\u{1F}abc123';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, { dryRun: false });

    expect(result.tags).toStrictEqual(['arrays-v1.1.0']);
    const workspace = result.workspaces[0];
    if (workspace?.status !== 'released') throw new Error('expected released');
    expect(workspace.changelogFiles).toStrictEqual([
      'packages/arrays/CHANGELOG.md',
      'packages/arrays/docs/CHANGELOG.md',
    ]);
    // After the SSOT pivot, cliff `--context` is invoked once per workspace (it returns the
    // full release history) and the markdown renderer is called once per `changelogPaths` entry.
    expect(countCliffCalls()).toBe(1);
    expect(
      mockWriteChangelogMarkdown.mock.calls.map((call) =>
        isRenderCallArg(call[0]) ? call[0].changelogPath : undefined,
      ),
    ).toStrictEqual(['packages/arrays', 'packages/arrays/docs']);
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

      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') {
          const matchArg = args.find((a: string) => a.startsWith('--match='));
          if (matchArg?.includes('core-v')) return 'core-v1.0.0\n';
          if (matchArg?.includes('app-v')) return 'app-v2.0.0\n';
        }
        if (cmd === 'git' && args[0] === 'log') {
          const hasCorePath = args.includes('packages/core/**');
          if (hasCorePath) return 'feat: add utility\u{1F}abc123';
          return '';
        }
        return '';
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

      const result = releasePrepareMono(config, { dryRun: false });

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

      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') {
          const matchArg = args.find((a: string) => a.startsWith('--match='));
          if (matchArg?.includes('core-v')) return 'core-v1.0.0\n';
          if (matchArg?.includes('app-v')) return 'app-v1.0.0\n';
        }
        if (cmd === 'git' && args[0] === 'log') {
          const hasCorePath = args.includes('packages/core/**');
          if (hasCorePath) return 'fix: bug fix\u{1F}abc123';
          return '';
        }
        return '';
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

      releasePrepareMono(config, { dryRun: false });

      // git-cliff (via buildChangelogEntries) is called only for core (direct), not for app (propagated).
      expect(countCliffCalls()).toBe(1);
      const cliffArgs = findCliffCallArgs();
      expect(cliffArgs).toContain('packages/core/CHANGELOG.md');

      // Synthetic propagation entry constructor was called for the app workspace.
      expect(mockBuildSyntheticChangelogEntry).toHaveBeenCalledTimes(1);
      const propagatedFromArg = mockBuildSyntheticChangelogEntry.mock.calls[0]?.[0];
      expect(JSON.stringify(propagatedFromArg)).toContain('@test/core');
      // The renderer was invoked for the app's changelog path.
      const appRenderCall = mockWriteChangelogMarkdown.mock.calls.find(
        (call) => isRenderCallArg(call[0]) && call[0].changelogPath === 'packages/app',
      );
      expect(appRenderCall).toBeDefined();
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

      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') return 'core-v1.0.0\n';
        if (cmd === 'git' && args[0] === 'log') return 'feat: new feature\u{1F}abc123';
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/core', version: '1.0.0' }));

      const result = releasePrepareMono(config, { dryRun: false });

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

      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') return 'core-v0.5.0\n';
        if (cmd === 'git' && args[0] === 'log') return '';
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/core', version: '0.5.0' }));
      mockExistsSync.mockReturnValue(false);

      const result = releasePrepareMono(config, { dryRun: false, setVersion: '1.0.0' });

      const coreResult = result.workspaces.find((c) => c.name === 'core');
      expect(coreResult).toMatchObject({
        status: 'released',
        newVersion: '1.0.0',
        currentVersion: '0.5.0',
        setVersion: '1.0.0',
      });
      if (coreResult?.status !== 'released') throw new Error('expected released');
      expect(coreResult.releaseType).toBeUndefined();
      expect(result.tags).toStrictEqual(['core-v1.0.0']);
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        'packages/core/package.json',
        expect.stringContaining('"version": "1.0.0"'),
        'utf8',
      );
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

      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') return 'core-v0.5.0\n';
        if (cmd === 'git' && args[0] === 'log') return '';
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/core', version: '0.5.0' }));

      expect(() => releasePrepareMono(config, { dryRun: false, setVersion: '0.3.0' })).toThrow(
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

      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') return 'core-v0.5.0\n';
        if (cmd === 'git' && args[0] === 'log') return '';
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/core', version: '0.5.0' }));

      expect(() => releasePrepareMono(config, { dryRun: false, setVersion: '0.5.0' })).toThrow(
        '--set-version 0.5.0 is not greater than current version 0.5.0',
      );
    });

    it('does not write files in dry-run mode with --set-version', () => {
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

      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') return 'core-v0.5.0\n';
        if (cmd === 'git' && args[0] === 'log') return '';
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/core', version: '0.5.0' }));
      mockExistsSync.mockReturnValue(false);

      const result = releasePrepareMono(config, { dryRun: true, setVersion: '1.0.0' });

      expect(result.tags).toStrictEqual(['core-v1.0.0']);
      expect(result.dryRun).toBe(true);
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

      expect(() => releasePrepareMono(config, { dryRun: false, setVersion: '1.0.0' })).toThrow(
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

      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') {
          const matchArg = args.find((a: string) => a.startsWith('--match='));
          if (matchArg?.includes('core-v')) return 'core-v1.0.0\n';
          if (matchArg?.includes('app-v')) return 'app-v2.0.0\n';
        }
        if (cmd === 'git' && args[0] === 'log') {
          // Both have commits.
          const hasCorePath = args.includes('packages/core/**');
          if (hasCorePath) return 'fix: core fix\u{1F}abc123';
          return 'feat: app feature\u{1F}def456';
        }
        return '';
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

      const result = releasePrepareMono(config, { dryRun: false });

      // app has its own minor bump from commits; propagation adds metadata but keeps minor.
      const appResult = result.workspaces.find((c) => c.name === 'app');
      expect(appResult).toMatchObject({
        status: 'released',
        releaseType: 'minor',
        propagatedFrom: [{ packageName: '@test/core', newVersion: '1.0.1' }],
      });
    });
  });

  describe('empty-range releases', () => {
    // When a workspace is forced to release (`--force`, `--bump=X`, or `--set-version`) with
    // zero qualifying commits since its last tag, git-cliff is bypassed in favor of a
    // synthetic "Notes / Forced version bump." entry. Without this branch, git-cliff emits
    // 2 × N `WARN  git_cliff > There is already a tag` lines per prepare run (issue #369).

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

    /** Stub git so the workspace has a tag but no qualifying commits since it. */
    function stubEmptyRange(): void {
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') return 'arrays-v1.0.0\n';
        if (cmd === 'git' && args[0] === 'log') return '';
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/arrays', version: '1.0.0' }));
      mockExistsSync.mockReturnValue(false);
    }

    it('writes a synthetic Notes / Forced version bump entry when --force is used with no commits', () => {
      stubEmptyRange();

      const result = releasePrepareMono(singleWorkspaceConfig(), { dryRun: false, force: true });

      expect(result.tags).toStrictEqual(['arrays-v1.0.1']);

      // The empty-range branch builds a synthetic Notes entry (mocked) and routes it through
      // the markdown renderer; assert on the renderer's args.
      expect(mockBuildEmptyReleaseEntry).toHaveBeenCalledWith('1.0.1', expect.any(String));
      const renderCall = mockWriteChangelogMarkdown.mock.calls.find(
        (call) => isRenderCallArg(call[0]) && call[0].changelogPath === 'packages/arrays',
      );
      expect(renderCall).toBeDefined();
    });

    it('does not invoke git-cliff for an empty-range workspace', () => {
      stubEmptyRange();

      releasePrepareMono(singleWorkspaceConfig(), { dryRun: false, bumpOverride: 'minor' });

      expect(countCliffCalls()).toBe(0);
    });

    it('upserts a synthetic empty-range entry into changelog.json when enabled', () => {
      stubEmptyRange();

      releasePrepareMono(
        singleWorkspaceConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }),
        { dryRun: false, force: true },
      );

      expect(mockBuildEmptyReleaseEntry).toHaveBeenCalledTimes(1);
      expect(mockBuildEmptyReleaseEntry).toHaveBeenCalledWith('1.0.1', expect.any(String));
      expect(mockBuildChangelogEntries).not.toHaveBeenCalled();
      expect(mockUpsertChangelogJsonAndReturn).toHaveBeenCalledTimes(1);
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

      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') {
          const matchArg = args.find((a: string) => a.startsWith('--match='));
          if (matchArg?.includes('core-v')) return 'core-v1.0.0\n';
          if (matchArg?.includes('app-v')) return 'app-v1.0.0\n';
        }
        if (cmd === 'git' && args[0] === 'log') {
          const hasCorePath = args.includes('packages/core/**');
          if (hasCorePath) return 'fix: bug fixabc123';
          return '';
        }
        return '';
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

      releasePrepareMono(config, { dryRun: false });

      // The propagation-only path constructs a synthetic propagation entry, not an empty-range
      // entry. Both constructors are mocked, so observe the call counts.
      expect(mockBuildSyntheticChangelogEntry).toHaveBeenCalledTimes(1);
      // For the app workspace specifically, the empty-range entry is NOT used.
      // (The test only has core + app, and core is on the cliff path → no empty-range
      // build for any workspace.)
      expect(mockBuildEmptyReleaseEntry).not.toHaveBeenCalled();
    });

    it('keeps workspaces with real commits on the cliff path (no regression)', () => {
      const config = singleWorkspaceConfig();
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') return 'arrays-v1.0.0\n';
        if (cmd === 'git' && args[0] === 'log') return 'feat: new utilityabc123';
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/arrays', version: '1.0.0' }));

      releasePrepareMono(config, { dryRun: false });

      // Real commits → cliff path runs.
      expect(countCliffCalls()).toBe(1);
    });

    it('does not write synthetic entries for workspaces correctly skipped (no commits, no --force)', () => {
      stubEmptyRange();

      const result = releasePrepareMono(singleWorkspaceConfig(), { dryRun: false });

      expect(result.tags).toStrictEqual([]);
      expect(result.workspaces[0]).toMatchObject({ status: 'skipped' });
      // No CHANGELOG.md write for the skipped workspace.
      const changelogWrites = mockWriteFileSync.mock.calls.filter(
        (call: unknown[]) => call[0] === 'packages/arrays/CHANGELOG.md',
      );
      expect(changelogWrites).toHaveLength(0);
    });

    it('skips synthetic file writes in dry-run mode but still returns tag and changelog path', () => {
      stubEmptyRange();

      const result = releasePrepareMono(
        singleWorkspaceConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }),
        { dryRun: true, force: true },
      );

      expect(result.tags).toStrictEqual(['arrays-v1.0.1']);
      const workspace = result.workspaces[0];
      if (workspace?.status !== 'released') throw new Error('expected released');
      expect(workspace.changelogFiles).toStrictEqual(['packages/arrays/CHANGELOG.md']);

      // No CHANGELOG.md write under dry-run; the path is still surfaced.
      const changelogWrites = mockWriteFileSync.mock.calls.filter(
        (call: unknown[]) => call[0] === 'packages/arrays/CHANGELOG.md',
      );
      expect(changelogWrites).toHaveLength(0);
      expect(mockUpsertChangelogJson).not.toHaveBeenCalled();
    });

    it('does not invoke git-cliff for any empty-range unit in a multi-workspace --force run', () => {
      // Pins the SHOULD-have acceptance criterion: a `prepare --force` run against multiple
      // zero-commit workspaces does not invoke `runGitCliff` for those workspaces — the
      // root cause of the `2 × N` `WARN  git_cliff > There is already a tag` amplification
      // (issue #369). For each empty-range workspace, today's behavior would emit two
      // git-cliff invocations (one for `generateChangelog`, one for `buildChangelogEntries
      // --context`); the synthetic path bypasses both.
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

      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') {
          const matchArg = args.find((a: string) => a.startsWith('--match='));
          if (matchArg?.includes('arrays-v')) return 'arrays-v1.0.0\n';
          if (matchArg?.includes('strings-v')) return 'strings-v1.0.0\n';
          if (matchArg?.includes('numbers-v')) return 'numbers-v1.0.0\n';
        }
        // No commits for any workspace.
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));
      mockExistsSync.mockReturnValue(false);

      releasePrepareMono(config, { dryRun: false, force: true });

      // Three workspaces, all empty-range, all forced — git-cliff must be invoked zero times.
      expect(countCliffCalls()).toBe(0);
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

    /** Stub git so the workspace has a feat commit since the prior tag. */
    function stubFeatCommit(): void {
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') return 'arrays-v1.0.0\n';
        if (cmd === 'git' && args[0] === 'log') return 'feat: add utilityabc123';
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/arrays', version: '1.0.0' }));
      mockExistsSync.mockReturnValue(false);
    }

    it('does not write changelog.json when changelogJson.enabled is false', () => {
      // Regression: the SSOT pivot previously called `upsertChangelogJsonAndReturn` (a write)
      // unconditionally, silently creating `.meta/changelog.json` for users who had opted out.
      // The fix routes through the pure read-and-merge path when `enabled` is false.
      stubFeatCommit();

      releasePrepareMono(
        singleWorkspaceConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: false } }),
        { dryRun: false },
      );

      expect(mockUpsertChangelogJsonAndReturn).not.toHaveBeenCalled();
      expect(mockMergeChangelogEntriesWithDisk).toHaveBeenCalledTimes(1);
    });

    it('writes changelog.json when changelogJson.enabled is true', () => {
      stubFeatCommit();

      releasePrepareMono(
        singleWorkspaceConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }),
        { dryRun: false },
      );

      expect(mockUpsertChangelogJsonAndReturn).toHaveBeenCalledTimes(1);
      expect(mockMergeChangelogEntriesWithDisk).not.toHaveBeenCalled();
    });
  });

  describe('opportunistic hint when baseline is missing', () => {
    /** Configure mocks for a single workspace with no baseline tag and a bump-worthy commit. */
    function setupNoBaseline(tagListOutput: string[], bumpCommit: string): void {
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') {
          throw Object.assign(new Error('no tag'), { status: 128 });
        }
        if (cmd === 'git' && args[0] === 'log') {
          return bumpCommit;
        }
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
      setupNoBaseline(['core-v0.2.7', 'core-v0.2.8'], 'feat: addabc');
      const messages: string[] = [];
      const errorSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
        messages.push(String(chunk));
        return true;
      });

      releasePrepareMono(config, { dryRun: true });

      expect(messages).toHaveLength(1);
      const message = messages[0] ?? '';
      expect(message).toContain("no baseline tag found for core under 'nmr-core-v'");
      expect(message).toContain('candidate-shaped tags');
      expect(message).toContain('core-v0.2.7');
      expect(message).toContain('show-tag-prefixes');
      errorSpy.mockRestore();
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
      setupNoBaseline(['core-v0.2.7'], 'feat: addabc');
      const messages: string[] = [];
      const errorSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
        messages.push(String(chunk));
        return true;
      });

      releasePrepareMono(config, { dryRun: true });

      expect(messages).toHaveLength(0);
      errorSpy.mockRestore();
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
      setupNoBaseline([], 'feat: addabc');
      const messages: string[] = [];
      const errorSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
        messages.push(String(chunk));
        return true;
      });

      releasePrepareMono(config, { dryRun: true });

      expect(messages).toHaveLength(0);
      errorSpy.mockRestore();
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
      setupNoBaseline(['node-monorepo-arrays-v1.0.0', 'node-monorepo-arrays-v1.1.0'], 'feat: addabc');
      const messages: string[] = [];
      const errorSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
        messages.push(String(chunk));
        return true;
      });

      releasePrepareMono(config, { dryRun: true });

      expect(messages).toHaveLength(0);
      errorSpy.mockRestore();
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
      setupNoBaseline(['arrays-v0.5.0', 'arrays-v0.6.0'], 'feat: addabc');
      const messages: string[] = [];
      const errorSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
        messages.push(String(chunk));
        return true;
      });

      releasePrepareMono(config, { dryRun: true });

      expect(messages).toHaveLength(0);
      errorSpy.mockRestore();
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
      setupNoBaseline(['core-v0.2.7', 'arrays-v0.1.0'], 'feat: addabc');
      const messages: string[] = [];
      const errorSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
        messages.push(String(chunk));
        return true;
      });

      releasePrepareMono(config, { dryRun: true });

      expect(messages).toHaveLength(1);
      errorSpy.mockRestore();
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
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') {
          return 'arrays-v1.0.0\n';
        }
        if (cmd === 'git' && args[0] === 'log') {
          return 'feat: addabc';
        }
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      const result = releasePrepareMono(config, { dryRun: false });

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
        project: { tagPrefix: 'v' },
      });
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') {
          const matchArg = args.find((a: string) => a.startsWith('--match='));
          if (matchArg === '--match=arrays-v*') return 'arrays-v1.0.0\n';
          if (matchArg === '--match=v*') return 'v0.9.0\n';
        }
        if (cmd === 'git' && args[0] === 'log') {
          return 'feat: shipabc123';
        }
        return '';
      });
      mockReadFileSync.mockImplementation((filePath: string) => {
        if (filePath === './package.json') return JSON.stringify({ name: 'root', version: '0.9.0' });
        return JSON.stringify({ version: '1.0.0' });
      });

      const result = releasePrepareMono(config, { dryRun: false });

      expect(result.project).toBeDefined();
      const project = result.project;
      if (project?.status !== 'released') throw new Error('expected released project');
      expect(project.tag).toBe('v0.10.0');
      expect(project.releaseType).toBe('minor');
      expect(result.tags).toContain('arrays-v1.1.0');
      expect(result.tags).toContain('v0.10.0');
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
        project: { tagPrefix: 'v' },
      });
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') {
          const matchArg = args.find((a: string) => a.startsWith('--match='));
          if (matchArg === '--match=arrays-v*') return 'arrays-v1.0.0\n';
          if (matchArg === '--match=v*') return 'v0.9.0\n';
        }
        if (cmd === 'git' && args[0] === 'log') {
          return 'feat: shipabc123';
        }
        return '';
      });
      mockReadFileSync.mockImplementation((filePath: string) => {
        if (filePath === './package.json') return JSON.stringify({ name: 'root', version: '0.9.0' });
        return JSON.stringify({ version: '1.0.0' });
      });

      releasePrepareMono(config, { dryRun: false });

      expect(mockExecSync).toHaveBeenCalledTimes(1);
      const formatCall = mockExecSync.mock.calls[0]?.[0];
      expect(formatCall).toContain('packages/arrays/package.json');
      expect(formatCall).toContain('./package.json');
      expect(formatCall).toContain('./CHANGELOG.md');
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
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') {
          return 'arrays-v1.0.0\n';
        }
        if (cmd === 'git' && args[0] === 'log') {
          return 'feat: add utilityabc123';
        }
        // git-cliff context output (used when changelogJson.enabled is true)
        return '[]';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));
      return config;
    }

    it('invokes writeReleaseNotesPreviews for each released workspace when enabled', () => {
      const config = setupArraysWithFeat();

      releasePrepareMono(config, { dryRun: false, withReleaseNotes: true });

      expect(mockWriteReleaseNotesPreviews).toHaveBeenCalledTimes(1);
      expect(mockWriteReleaseNotesPreviews).toHaveBeenCalledWith(
        expect.objectContaining({
          workspacePath: 'packages/arrays',
          tag: 'arrays-v1.1.0',
          dryRun: false,
          sectionOrder: expect.any(Array),
        }),
      );
    });

    it('does not invoke writeReleaseNotesPreviews when the flag is not set', () => {
      const config = setupArraysWithFeat();

      releasePrepareMono(config, { dryRun: false });

      expect(mockWriteReleaseNotesPreviews).not.toHaveBeenCalled();
    });

    it('warns and skips when --with-release-notes is set but changelogJson.enabled is false', () => {
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
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') {
          return 'arrays-v1.0.0\n';
        }
        if (cmd === 'git' && args[0] === 'log') {
          return 'feat: add utilityabc123';
        }
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      releasePrepareMono(config, { dryRun: false, withReleaseNotes: true });

      expect(mockWriteReleaseNotesPreviews).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('--with-release-notes requires changelogJson.enabled'),
      );
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
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') {
          return 'arrays-v1.0.0\n';
        }
        if (cmd === 'git' && args[0] === 'log') {
          return '';
        }
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/arrays', version: '1.0.0' }));

      releasePrepareMono(config, { dryRun: false, withReleaseNotes: true });

      expect(mockWriteReleaseNotesPreviews).not.toHaveBeenCalled();
    });

    it('propagates dryRun through to writeReleaseNotesPreviews', () => {
      const config = setupArraysWithFeat();

      releasePrepareMono(config, { dryRun: true, withReleaseNotes: true });

      expect(mockWriteReleaseNotesPreviews).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    });

    it('invokes writeReleaseNotesPreviews for both direct-bumped and propagation-only workspaces', () => {
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

      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') {
          const matchArg = args.find((a: string) => a.startsWith('--match='));
          if (matchArg?.includes('core-v')) return 'core-v1.0.0\n';
          if (matchArg?.includes('app-v')) return 'app-v2.0.0\n';
        }
        if (cmd === 'git' && args[0] === 'log') {
          const hasCorePath = args.includes('packages/core/**');
          if (hasCorePath) return 'feat: add utilityabc123';
          return '';
        }
        // git-cliff context output (used when changelogJson.enabled is true)
        return '[]';
      });
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

      releasePrepareMono(config, { dryRun: false, withReleaseNotes: true });

      expect(mockWriteReleaseNotesPreviews).toHaveBeenCalledTimes(2);
      // Confirm each workspace received a preview call with the correct workspacePath and tag.
      expect(mockWriteReleaseNotesPreviews).toHaveBeenCalledWith(
        expect.objectContaining({ workspacePath: 'packages/core', tag: 'core-v1.1.0' }),
      );
      expect(mockWriteReleaseNotesPreviews).toHaveBeenCalledWith(
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

    /** Run `fn` and return the thrown Error. Fails the test if no Error is thrown. */
    function captureError(fn: () => unknown): Error {
      try {
        fn();
      } catch (error) {
        if (error instanceof Error) return error;
        throw new Error(`Expected an Error to be thrown, got ${typeof error}: ${String(error)}`);
      }
      throw new Error('Expected fn to throw, but it returned normally');
    }

    it("wraps a Phase 1 (bump-determination) throw with the workspace's release-stage label", () => {
      const config = makeArraysConfig();
      // Make the very first git invocation (`getCommitsSinceTarget`) throw — this exercises
      // the Phase 1 wrap inside `determineDirectBumps`.
      const underlying = new Error('git describe failed: not a git repo');
      mockExecFileSync.mockImplementation(() => {
        throw underlying;
      });

      const wrapped = captureError(() => releasePrepareMono(config, { dryRun: false }));

      expect(wrapped.message).toMatch(/^workspace 'arrays' release stage: .*git describe failed: not a git repo$/);
      // `cause` is preserved through the chain — at minimum, an Error instance.
      expect(wrapped.cause).toBeInstanceOf(Error);
    });

    it("wraps a Phase 3 (executeWorkspaceRelease) throw with the workspace's release-stage label", () => {
      const config = makeArraysConfig();
      // Phase 1 succeeds (git describe + git log succeed). `buildChangelogEntries` (which
      // `executeWorkspaceRelease` invokes) throws — this exercises the Phase 3 wrap inside
      // `executeReleaseSet`.
      const underlying = new Error('git-cliff exited with status 1');
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') return 'arrays-v1.0.0\n';
        if (cmd === 'git' && args[0] === 'log') return 'feat: addabc123';
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));
      mockBuildChangelogEntries.mockImplementationOnce(() => {
        throw underlying;
      });

      const wrapped = captureError(() => releasePrepareMono(config, { dryRun: false }));

      expect(wrapped.message).toMatch(/^workspace 'arrays' release stage: .*git-cliff exited with status 1$/);
      // `cause` is preserved through the chain — at minimum, an Error instance.
      expect(wrapped.cause).toBeInstanceOf(Error);
    });

    it('wraps a project-stage throw with the project release-stage label', () => {
      const config = makeArraysConfig({ project: { tagPrefix: 'v' } });
      // Workspace stage succeeds; `buildChangelogEntries` for the project stage throws.
      const underlying = new Error('cliff exploded on root');
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') {
          const matchArg = args.find((a: string) => a.startsWith('--match='));
          if (matchArg === '--match=arrays-v*') return 'arrays-v1.0.0\n';
          if (matchArg === '--match=v*') return 'v0.9.0\n';
        }
        if (cmd === 'git' && args[0] === 'log') return `feat: shipabc123`;
        return '';
      });
      mockReadFileSync.mockImplementation((filePath: string) => {
        if (filePath === './package.json') return JSON.stringify({ name: 'root', version: '0.9.0' });
        return JSON.stringify({ version: '1.0.0' });
      });
      // First call (workspace stage) returns the default stub; second call (project stage)
      // throws. `buildChangelogEntries` is the cliff entry point in both stages after the
      // SSOT pivot.
      let buildCallCount = 0;
      mockBuildChangelogEntries.mockImplementation(() => {
        buildCallCount += 1;
        if (buildCallCount >= 2) throw underlying;
        return [];
      });

      const wrapped = captureError(() => releasePrepareMono(config, { dryRun: false }));

      expect(wrapped.message).toMatch(/^project release stage: .*cliff exploded on root$/);
      expect(wrapped.cause).toBeInstanceOf(Error);
    });

    it('wraps a format-stage throw with the format-stage label and the failing command', () => {
      const config = makeArraysConfig({ formatCommand: 'npx prettier --write' });
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') return 'arrays-v1.0.0\n';
        if (cmd === 'git' && args[0] === 'log') return 'feat: addbarabc123';
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));
      const underlying = new Error('prettier exited 2');
      mockExecSync.mockImplementation(() => {
        throw underlying;
      });

      const wrapped = captureError(() => releasePrepareMono(config, { dryRun: false }));

      expect(wrapped.message).toMatch(/^format stage: prettier exited 2 \(command: 'npx prettier --write .+'\)$/);
      expect(wrapped.cause).toBe(underlying);
    });

    it('does not wrap --set-version validation throws with a stage label', () => {
      const config = makeArraysConfig();
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') return 'arrays-v0.5.0\n';
        if (cmd === 'git' && args[0] === 'log') return '';
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/arrays', version: '0.5.0' }));

      const wrapped = captureError(() => releasePrepareMono(config, { dryRun: false, setVersion: '0.3.0' }));

      expect(wrapped.message).toBe('--set-version 0.3.0 is not greater than current version 0.5.0');
      expect(wrapped.message).not.toContain('stage:');
    });
  });

  describe('policy violations', () => {
    /** ASCII unit separator (U+001F) used by `git log --pretty=format` to delimit subject from hash. */
    const SEP = String.fromCodePoint(0x1f);

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

    /** Format a single commit log line as the `getCommitsSinceTarget` parser expects. */
    function logLine(subject: string, hash: string): string {
      return `${subject}${SEP}${hash}`;
    }

    /** Stub git output for a single workspace with one log line per commit. */
    function stubLog(tag: string, logBody: string): void {
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') return `${tag}\n`;
        if (cmd === 'git' && args[0] === 'log') return logBody;
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));
    }

    it('omits policyViolations on a workspace whose only commit is a clean feat!', () => {
      const config = makeConfig({ workspaces: [makeWorkspace()], workTypes: DEFAULT_WORK_TYPES });
      stubLog('arrays-v1.0.0', logLine('feat!: drop legacy export', 'abc1234'));

      const result = releasePrepareMono(config, { dryRun: false });

      expect(result.workspaces[0]?.policyViolations).toBeUndefined();
    });

    it('records a prefix-surface violation for an internal! commit (forbidden policy)', () => {
      const config = makeConfig({ workspaces: [makeWorkspace()], workTypes: DEFAULT_WORK_TYPES });
      stubLog('arrays-v1.0.0', logLine('internal!: refactor cache', 'def5678'));

      const result = releasePrepareMono(config, { dryRun: false });

      expect(result.workspaces[0]?.policyViolations).toStrictEqual([
        {
          commitHash: 'def5678',
          commitSubject: 'internal!: refactor cache',
          type: 'internal',
          surface: 'prefix',
        },
      ]);
    });

    it('records a prefix-surface violation for a bare drop commit (required policy)', () => {
      const config = makeConfig({ workspaces: [makeWorkspace()], workTypes: DEFAULT_WORK_TYPES });
      stubLog('arrays-v1.0.0', logLine('drop: remove deprecated API', '9abc012'));

      const result = releasePrepareMono(config, { dryRun: false });

      expect(result.workspaces[0]?.policyViolations).toStrictEqual([
        {
          commitHash: '9abc012',
          commitSubject: 'drop: remove deprecated API',
          type: 'drop',
          surface: 'prefix',
        },
      ]);
    });

    it('produces no violations when breakingPolicies is set to {} (opt-out)', () => {
      const config = makeConfig({
        workspaces: [makeWorkspace()],
        workTypes: DEFAULT_WORK_TYPES,
        breakingPolicies: {},
      });
      stubLog('arrays-v1.0.0', logLine('internal!: refactor cache', 'def5678'));

      const result = releasePrepareMono(config, { dryRun: false });

      expect(result.workspaces[0]?.policyViolations).toBeUndefined();
    });

    it('attaches violations only to the workspace whose commits triggered them', () => {
      // Two workspaces; one has an internal! commit (violation), the other has a clean feat.
      const cleanWorkspace = makeWorkspace({
        dir: 'core',
        name: '@test/core',
        tagPrefix: 'core-v',
        workspacePath: 'packages/core',
        packageFiles: ['packages/core/package.json'],
        changelogPaths: ['packages/core'],
        paths: ['packages/core/**'],
      });
      const config = makeConfig({
        workspaces: [makeWorkspace(), cleanWorkspace],
        workTypes: DEFAULT_WORK_TYPES,
      });

      // Per-workspace describe + log responses keyed by --match flags.
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd !== 'git') return '';
        if (args[0] === 'describe') {
          if (args.some((a) => a.includes('arrays-v'))) return 'arrays-v1.0.0\n';
          if (args.some((a) => a.includes('core-v'))) return 'core-v1.0.0\n';
        }
        if (args[0] === 'log') {
          if (args.includes('packages/arrays/**')) return logLine('internal!: refactor cache', 'def5678');
          if (args.includes('packages/core/**')) return logLine('feat: add helper', 'aaa1111');
        }
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      const result = releasePrepareMono(config, { dryRun: false });

      const arraysResult = result.workspaces.find((w) => w.name === 'arrays');
      const coreResult = result.workspaces.find((w) => w.name === 'core');
      expect(arraysResult?.policyViolations).toHaveLength(1);
      expect(coreResult?.policyViolations).toBeUndefined();
    });

    it('records a body-surface violation when BREAKING CHANGE: appears under a custom forbidden feat policy', () => {
      // The parser invokes `message.includes('BREAKING CHANGE:')` on the raw commit message;
      // any commit whose `.message` contains that literal triggers the body-surface code path.
      // Real git-log subjects (--pretty=format:%s) don't carry body footers, but the wiring still
      // needs to surface body-surface violations correctly when they appear (here: a subject
      // that itself contains the literal string).
      const config = makeConfig({
        workspaces: [makeWorkspace()],
        workTypes: DEFAULT_WORK_TYPES,
        breakingPolicies: { ...DEFAULT_BREAKING_POLICIES, feat: 'forbidden' },
      });
      stubLog('arrays-v1.0.0', logLine('feat: rework auth (BREAKING CHANGE: removes /v1)', 'body0001'));

      const result = releasePrepareMono(config, { dryRun: false });

      expect(result.workspaces[0]?.policyViolations).toStrictEqual([
        {
          commitHash: 'body0001',
          commitSubject: 'feat: rework auth (BREAKING CHANGE: removes /v1)',
          type: 'feat',
          surface: 'body',
        },
      ]);
    });

    // Note: there is no orchestrator-reachable path where a SkippedWorkspaceResult also
    // carries policyViolations — the unified `decideRelease` algorithm only enters the skip
    // branch when zero commits parsed, which means no violation could have fired. The
    // `SkippedResult.policyViolations` field is wired defensively for parity with the
    // released path but not exercised here.
  });

  describe('git-cliff cache refresh', () => {
    it('refreshes the git-cliff cache exactly once before any per-workspace cliff work call', () => {
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

      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') {
          const matchArg = args.find((a: string) => a.startsWith('--match='));
          if (matchArg?.includes('arrays-v')) {
            return 'arrays-v1.0.0\n';
          }
          if (matchArg?.includes('strings-v')) {
            return 'strings-v2.0.0\n';
          }
        }
        if (cmd === 'git' && args[0] === 'log') {
          return 'feat: changeabc123';
        }
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      releasePrepareMono(config, { dryRun: false });

      expect(countCacheRefreshCalls()).toBe(1);
      // The single warmup must precede every per-workspace cliff work invocation.
      expect(firstCacheRefreshCallIndex()).toBeLessThan(firstCliffWorkCallIndex());
    });

    it('refreshes the git-cliff cache even in dry-run mode (cliff is invoked under dry-run for changelog.json)', () => {
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

      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') return 'arrays-v1.0.0\n';
        if (cmd === 'git' && args[0] === 'log') return 'feat: changeabc123';
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      releasePrepareMono(config, { dryRun: true });

      expect(countCacheRefreshCalls()).toBe(1);
    });

    it('does not refresh the cache when every workspace skips (no cliff work to warm)', () => {
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

      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') {
          return 'arrays-v1.0.0\n';
        }
        if (cmd === 'git' && args[0] === 'log') {
          return '';
        }
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/arrays', version: '1.0.0' }));

      releasePrepareMono(config, { dryRun: false });

      expect(countCacheRefreshCalls()).toBe(0);
      expect(countCliffCalls()).toBe(0);
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

      // Stub git: one commit since the previous tag, with a known hash that does NOT match
      // the override key the workspace file declares.
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') {
          return 'arrays-v1.0.0\n';
        }
        if (cmd === 'git' && args[0] === 'log') {
          return 'feat: add utilityrealcommithash';
        }
        return '';
      });

      // Surface the workspace's `.meta/changelog-overrides.json` to the loader. Every other
      // existsSync probe (e.g., for prettier config) returns false.
      const workspaceOverridePath = 'packages/arrays/.meta/changelog-overrides.json';
      mockExistsSync.mockImplementation((path: string) => path.endsWith(workspaceOverridePath));
      mockReadFileSync.mockImplementation((path: string) => {
        if (typeof path === 'string' && path.endsWith(workspaceOverridePath)) {
          return JSON.stringify({ staleKeyAaa: { audience: 'skip' } });
        }
        return JSON.stringify({ name: '@test/arrays', version: '1.0.0' });
      });

      // Provide a stub changelog entry whose hash does NOT match the override key; the
      // override is therefore stale and the workspace-tier rule warns immediately.
      mockBuildChangelogEntries.mockReturnValue([
        {
          version: '1.1.0',
          date: '2024-01-01',
          sections: [
            {
              title: 'Features',
              audience: 'all',
              items: [{ description: 'Add utility', hash: 'realcommithash' }],
            },
          ],
        },
      ]);

      const result = releasePrepareMono(config, { dryRun: false });

      // The per-workspace stale-key warning must surface on PrepareResult.warnings — proves
      // `applyWorkspaceOverrides`'s `overrideWarnings.push(...)` is correctly threaded through
      // the orchestrator's final aggregation.
      expect(result.warnings).toBeDefined();
      const warnings = result.warnings ?? [];
      expect(warnings.some((message) => message.includes("'staleKeyAaa'"))).toBe(true);
      expect(warnings.some((message) => /stale reference/.test(message))).toBe(true);
    });
  });
});
