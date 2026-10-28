import { vi } from 'vitest';

import type { ReleasePlan } from '../releasePlan.ts';
import { resolvedPackages } from './workspaceResolutions.ts';

// A test loads this module through `vi.hoisted`, before its `vi.mock` calls register, so the module imports nothing
// under test: Such a module would bind the real dependencies.

export const mockAssertCleanWorkingTree = vi.fn();
export const mockDiscoverWorkspaces = vi.fn();
export const mockExecSync = vi.fn();
export const mockExistsSync = vi.fn();
export const mockLoadConfig = vi.fn();
export const mockLookUpNpmPackage = vi.fn();
export const mockReadFileSync = vi.fn();
export const mockPrepareReleaseTargets = vi.fn();
export const mockWriteFileWithCheck = vi.fn();

/**
 * Sets the defaults on which every `prepareCommand` suite builds: a monorepo of `arrays` and `strings` without a root
 * package.json, an empty plan, created writes, and every package published.
 */
export function applyPrepareCommandDefaults(): void {
  mockDiscoverWorkspaces.mockReturnValue(resolvedPackages(['packages/arrays', 'packages/strings']));
  mockLoadConfig.mockResolvedValue(undefined);
  // Tests that exercise the project block override this to return a valid version.
  mockExistsSync.mockReturnValue(false);
  mockReadFileSync.mockImplementation((filePath: string) => {
    if (filePath === 'packages/arrays/package.json') {
      return JSON.stringify({ name: '@scope/arrays' });
    }
    if (filePath === 'packages/strings/package.json') {
      return JSON.stringify({ name: '@scope/strings' });
    }
    throw new Error(`Unexpected readFileSync call for path: ${filePath}`);
  });
  mockPrepareReleaseTargets.mockReturnValue(makePrepareResult());
  mockWriteFileWithCheck.mockImplementation((path: string) => ({ filePath: path, outcome: 'created' }));
  mockLookUpNpmPackage.mockReturnValue({ status: 'published' });
}

/** Builds a minimal PrepareResult for mocking. */
export function makePrepareResult(overrides?: Partial<ReleasePlan>): ReleasePlan {
  return {
    targets: [],
    tags: [],
    writes: [],
    removals: [],
    summary: '',
    ...overrides,
  };
}

/** Resets every mock that this module exports. */
export function resetPrepareCommandMocks(): void {
  for (const mock of [
    mockAssertCleanWorkingTree,
    mockDiscoverWorkspaces,
    mockExecSync,
    mockExistsSync,
    mockLoadConfig,
    mockLookUpNpmPackage,
    mockReadFileSync,
    mockPrepareReleaseTargets,
    mockWriteFileWithCheck,
  ]) {
    mock.mockReset();
  }
}
