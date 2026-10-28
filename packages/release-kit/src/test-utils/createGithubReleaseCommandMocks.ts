import { vi } from 'vitest';

import { makeSinglePackage } from './workspaceResolutions.ts';

export const mockCreateGithubReleases = vi.fn();
export const mockDeriveReleaseNotesConfig = vi.fn();
export const mockDeriveWorkspaceConfig = vi.fn();
export const mockDiscoverWorkspaces = vi.fn();
export const mockLoadConfig = vi.fn();
export const mockResolveReleaseTags = vi.fn();

/**
 * Sets the defaults on which every `createGithubReleaseCommand` suite builds: a single-package repo whose HEAD carries
 * one publishable `v1.0.0` tag, and a release that succeeds.
 */
export function applyCreateGithubReleaseCommandDefaults(): void {
  mockDiscoverWorkspaces.mockReturnValue(makeSinglePackage());
  mockResolveReleaseTags.mockReturnValue([
    { tag: 'v1.0.0', kind: 'package', dir: '.', workspacePath: '.', isPublishable: true },
  ]);
  mockCreateGithubReleases.mockReturnValue({ createdTags: ['v1.0.0'], skippedTags: [] });
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
  mockDeriveReleaseNotesConfig.mockReturnValue({
    releaseNotes: { shouldInjectIntoReadme: false },
    changelogJsonOutputPath: '.meta/changelog.json',
    sectionOrder: ['Bug fixes', 'Features'],
  });
  mockLoadConfig.mockResolvedValue(undefined);
}

/** Resets every mock that this module exports. */
export function resetCreateGithubReleaseCommandMocks(): void {
  for (const mock of [
    mockCreateGithubReleases,
    mockDeriveReleaseNotesConfig,
    mockDeriveWorkspaceConfig,
    mockDiscoverWorkspaces,
    mockLoadConfig,
    mockResolveReleaseTags,
  ]) {
    mock.mockReset();
  }
}
