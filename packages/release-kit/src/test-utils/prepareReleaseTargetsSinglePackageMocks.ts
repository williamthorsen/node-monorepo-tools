import { vi } from 'vitest';

import type { ChangelogSection } from '../types.ts';
import { makeReleaseHistory, type ReleaseHistoryStub } from './releaseHistories.ts';

// A test loads this module through `vi.hoisted`, before its `vi.mock` calls register, so the module imports nothing
// under test: Such a module would bind the real dependencies.

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

export const featureSection: ChangelogSection = {
  title: 'Features',
  audience: 'all',
  items: [{ description: 'Add feature' }],
};

/**
 * Sets the defaults on which every single-package `prepareReleaseTargets` suite builds: The renderers return fixed
 * content, and `existsSync` reports every path missing, so that synthetic writes skip reading an existing file.
 */
export function applyPrepareReleaseTargetsSinglePackageDefaults(): void {
  mockMergeChangelogEntriesWithDisk.mockImplementation((_filePath: string, entries: unknown[]) => entries);
  mockRenderChangelogMarkdown.mockReturnValue('# Changelog\n');
  mockRenderChangelogJson.mockReturnValue('[]\n');
  mockPlanReleaseNotesPreviews.mockReturnValue({ writes: [], warnings: [] });
  mockExistsSync.mockReturnValue(false);
}

/** Resets every mock that this module exports. */
export function resetPrepareReleaseTargetsSinglePackageMocks(): void {
  for (const mock of [
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

/** Stubs the history that `readReleaseHistory` returns. */
export function stubHistory(stub: ReleaseHistoryStub): void {
  mockReadReleaseHistory.mockReturnValue(makeReleaseHistory(stub));
}

/** Stubs a history with one commit above v1.0.0 that calls for a minor bump, over a package at 1.0.0. */
export function stubMinorRelease(): void {
  stubHistory({
    previousTag: 'v1.0.0',
    commits: [['feat: add feature', 'abc123']],
    bump: 'minor',
    sections: [featureSection],
  });
  stubPackageVersion('1.0.0');
}

/** Stubs every package file's content as a manifest at `version`. */
export function stubPackageVersion(version: string): void {
  mockReadFileSync.mockReturnValue(JSON.stringify({ version }));
}
