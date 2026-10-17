import { vi } from 'vitest';

import type { ChangelogEntry } from '../types.ts';
import { makeReleaseHistory, type ReleaseHistoryStub } from './releaseHistories.ts';

// A test loads this module through `vi.hoisted`, before its `vi.mock` calls register, so the module imports nothing
// under test: Such a module would bind the real dependencies.

export const mockBuildEmptyReleaseEntry = vi.fn();
export const mockBuildSyntheticChangelogEntry = vi.fn();
export const mockExecFileSync = vi.fn();
export const mockExecSync = vi.fn();
export const mockExistsSync = vi.fn();
export const mockHasPrettierConfig = vi.fn();
export const mockMergeChangelogEntriesWithDisk = vi.fn();
export const mockPlanReleaseNotesPreviews = vi.fn();
export const mockReadFileSync = vi.fn();
export const mockReadReleaseHistory = vi.fn();
export const mockRenderChangelogJson = vi.fn();
export const mockRenderChangelogMarkdown = vi.fn();
export const mockWriteFileSync = vi.fn();

/** The entry that the mocked `buildEmptyReleaseEntry` returns. */
export const FORCED_BUMP_ENTRY: ChangelogEntry = {
  version: '0.0.0',
  date: '2024-01-01',
  sections: [{ title: 'Notes', audience: 'dev', items: [{ description: 'Forced version bump.' }] }],
};

/**
 * Sets the defaults on which every monorepo `releasePrepareTargets` suite builds: Every scope reads an empty history,
 * the synthetic constructor returns an empty stub entry, and the renderers return fixed content.
 */
export function applyReleasePrepareTargetsMonorepoDefaults(): void {
  mockReadReleaseHistory.mockReturnValue(makeReleaseHistory());
  mockBuildSyntheticChangelogEntry.mockReturnValue({ version: '0.0.0', date: '2024-01-01', sections: [] });
  mockBuildEmptyReleaseEntry.mockReturnValue(FORCED_BUMP_ENTRY);
  mockMergeChangelogEntriesWithDisk.mockImplementation((_filePath: string, entries: unknown[]) => entries);
  mockRenderChangelogMarkdown.mockReturnValue('# Changelog\n');
  mockRenderChangelogJson.mockReturnValue('[]\n');
  mockPlanReleaseNotesPreviews.mockReturnValue({ writes: [], warnings: [] });
}

/** Returns the options of every `readReleaseHistory` call, in call order. */
export function listReadOptions(): unknown[] {
  return mockReadReleaseHistory.mock.calls.map((call: unknown[]) => call[1]);
}

/** Resets every mock that this module exports. */
export function resetReleasePrepareTargetsMonorepoMocks(): void {
  for (const mock of [
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
  ]) {
    mock.mockReset();
  }
}

/** Stubs the filesystem as containing exactly `files`, keyed by path. */
export function stubFiles(files: Record<string, string>): void {
  mockExistsSync.mockImplementation((path: string) => Object.hasOwn(files, path));
  mockReadFileSync.mockImplementation((path: string) => {
    const content = files[path];
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  });
}

/** Stubs the release history that `readReleaseHistory` returns for every scope. */
export function stubHistory(stub: ReleaseHistoryStub): void {
  mockReadReleaseHistory.mockReturnValue(makeReleaseHistory(stub));
}

/** Stubs the release history per scope, keyed by a tag prefix that `readReleaseHistory` receives. */
export function stubHistoryByPrefix(stubs: Record<string, ReleaseHistoryStub>): void {
  mockReadReleaseHistory.mockImplementation((_config: unknown, options: { tagPrefixes: readonly string[] }) => {
    const stub = options.tagPrefixes.map((prefix) => stubs[prefix]).find((found) => found !== undefined);
    return makeReleaseHistory(stub);
  });
}
