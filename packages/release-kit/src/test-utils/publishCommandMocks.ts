import { vi } from 'vitest';

import { makeSinglePackage } from './workspaceResolutions.ts';

export const mockAssertCleanWorkingTree = vi.fn();
export const mockCreateGithubReleases = vi.fn();
export const mockDeriveWorkspaceConfig = vi.fn();
export const mockDetectPackageManager = vi.fn();
export const mockDiscoverWorkspaces = vi.fn();
export const mockInjectReleaseNotesIntoReadme = vi.fn();
export const mockLoadConfig = vi.fn();
export const mockPublishPackage = vi.fn();
export const mockResolveReadmePath = vi.fn();
export const mockResolveReleaseTags = vi.fn();
export const mockValidateConfig = vi.fn();
export const mockWriteFileSync = vi.fn();

/**
 * Sets the defaults on which every `publishCommand` suite builds: a single-package npm repo whose HEAD carries one
 * publishable `v1.0.0` tag, an empty valid config, and a package without a README.
 */
export function applyPublishCommandDefaults(): void {
  mockDiscoverWorkspaces.mockReturnValue(makeSinglePackage());
  mockResolveReleaseTags.mockReturnValue([
    { tag: 'v1.0.0', kind: 'package', dir: '.', workspacePath: '.', isPublishable: true },
  ]);
  mockDetectPackageManager.mockReturnValue('npm');
  mockLoadConfig.mockResolvedValue(undefined);
  mockValidateConfig.mockReturnValue({ config: {}, errors: [], warnings: [] });
  mockResolveReadmePath.mockReturnValue(undefined);
  mockDeriveWorkspaceConfig.mockImplementation((workspacePath: string) => {
    const dir = workspacePath.split('/').pop() ?? workspacePath;
    return {
      dir,
      name: `@test/${dir}`,
      tagPrefix: `${dir}-v`,
      workspacePath,
      isPublishable: true,
      packageFiles: [`${workspacePath}/package.json`],
      paths: [`${workspacePath}/**`],
    };
  });
}

/** Resets every mock that this module exports. */
export function resetPublishCommandMocks(): void {
  for (const mock of [
    mockAssertCleanWorkingTree,
    mockCreateGithubReleases,
    mockDeriveWorkspaceConfig,
    mockDetectPackageManager,
    mockDiscoverWorkspaces,
    mockInjectReleaseNotesIntoReadme,
    mockLoadConfig,
    mockPublishPackage,
    mockResolveReadmePath,
    mockResolveReleaseTags,
    mockValidateConfig,
    mockWriteFileSync,
  ]) {
    mock.mockReset();
  }
}
