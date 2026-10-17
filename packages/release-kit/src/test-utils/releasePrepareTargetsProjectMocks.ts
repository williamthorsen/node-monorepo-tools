import { expect, vi } from 'vitest';

import type { MonorepoReleaseConfig } from '../types.ts';
import { makeReleaseHistory, type ReleaseHistoryStub } from './releaseHistories.ts';

// A test loads this module through `vi.hoisted`, before its `vi.mock` calls register, so the module imports nothing
// under test: Such a module would bind the real dependencies.

export const mockCopyFileSync = vi.fn();
export const mockExecFileSync = vi.fn();
export const mockExistsSync = vi.fn();
export const mockMergeChangelogEntriesWithDisk = vi.fn();
export const mockMkdirSync = vi.fn();
export const mockMkdtempSync = vi.fn();
export const mockPlanReleaseNotesPreviews = vi.fn();
export const mockReadFileSync = vi.fn();
export const mockReadReleaseHistory = vi.fn();
export const mockRenderChangelogJson = vi.fn();
export const mockRenderChangelogMarkdown = vi.fn();
export const mockRmSync = vi.fn();
export const mockWriteFileSync = vi.fn();

/**
 * Sets the defaults on which every project-composite `releasePrepareTargets` suite builds: The renderers return fixed
 * content, the root manifest is at 0.9.0, and every other path is missing.
 */
export function applyReleasePrepareTargetsProjectDefaults(): void {
  mockMergeChangelogEntriesWithDisk.mockImplementation((_filePath: string, entries: unknown[]) => entries);
  mockRenderChangelogMarkdown.mockReturnValue('# Changelog\n');
  mockRenderChangelogJson.mockReturnValue('[]\n');
  mockPlanReleaseNotesPreviews.mockReturnValue({ writes: [], warnings: [] });
  mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'root', version: '0.9.0' }));
  mockExistsSync.mockReturnValue(false);
}

/** Asserts that the run read the project's history exactly once, under the project tag prefix and `paths`. */
export function expectOneHistoryRead(config: MonorepoReleaseConfig, paths: string[]): void {
  expect(mockReadReleaseHistory).toHaveBeenCalledTimes(1);
  expect(mockReadReleaseHistory).toHaveBeenCalledWith(expect.objectContaining({ workTypes: config.workTypes }), {
    tagPrefixes: ['v'],
    paths,
  });
}

/** Resets every mock that this module exports. */
export function resetReleasePrepareTargetsProjectMocks(): void {
  for (const mock of [
    mockCopyFileSync,
    mockExecFileSync,
    mockExistsSync,
    mockMergeChangelogEntriesWithDisk,
    mockMkdirSync,
    mockMkdtempSync,
    mockPlanReleaseNotesPreviews,
    mockReadFileSync,
    mockReadReleaseHistory,
    mockRenderChangelogJson,
    mockRenderChangelogMarkdown,
    mockRmSync,
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

/** Stubs the history that `readReleaseHistory` returns. */
export function stubHistory(stub: ReleaseHistoryStub): void {
  mockReadReleaseHistory.mockReturnValue(makeReleaseHistory(stub));
}
