import type { StreamStyles } from '@williamthorsen/nmr-core';
import { type CapturedStdio, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { silenceConsole, throwOnProcessExit } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  applyCreateGithubReleaseCommandDefaults,
  mockCreateGithubReleases,
  mockDeriveReleaseNotesConfig,
  mockDeriveWorkspaceConfig,
  mockDiscoverWorkspaces,
  mockLoadConfig,
  mockResolveReleaseTags,
  resetCreateGithubReleaseCommandMocks,
} = await vi.hoisted(() => import('../test-utils/createGithubReleaseCommandMocks.ts'));

// Partial, so that `describeEmptyWorkspace` stays the real composer: What a caller does with an empty
// resolution is the subject here, and its wording is covered against the composer itself.
vi.mock(import('../discoverWorkspaces.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  discoverWorkspaces: mockDiscoverWorkspaces,
}));

vi.mock(import('../resolveReleaseTags.ts'), () => ({
  resolveReleaseTags: mockResolveReleaseTags,
}));

vi.mock(import('../createGithubRelease.ts'), () => ({
  createGithubReleases: mockCreateGithubReleases,
}));

vi.mock(import('../deriveReleaseNotesConfig.ts'), () => ({
  deriveReleaseNotesConfig: mockDeriveReleaseNotesConfig,
}));

vi.mock(import('../deriveWorkspaceConfig.ts'), () => ({
  deriveWorkspaceConfig: mockDeriveWorkspaceConfig,
}));

vi.mock(import('../loadConfig.ts'), async (importOriginal) => {
  const originalModule = await importOriginal();
  return {
    ...originalModule,
    loadConfig: mockLoadConfig,
    readRootPackageVersion: () => ({ doesExist: true, version: '1.0.0' }),
  };
});

import { createGithubReleaseCommand } from '../createGithubReleaseCommand.ts';
import { resolvedPackages } from '../test-utils/workspaceResolutions.ts';

const RICH_STYLES: StreamStyles = { stderr: 'rich', stdout: 'rich' };

describe(createGithubReleaseCommand, () => {
  let stdioCapture: CapturedStdio;

  beforeEach(() => {
    stdioCapture = captureStdio();
    applyCreateGithubReleaseCommandDefaults();
    void throwOnProcessExit();
    void silenceConsole(['info', 'warn']);
  });

  afterEach(() => {
    stdioCapture[Symbol.dispose]();
    resetCreateGithubReleaseCommandMocks();
    vi.restoreAllMocks();
  });

  describe('directory tag', () => {
    it('creates a Release for a directory tag, which is never publishable', async () => {
      const DIRECTORY_TAG = {
        tag: 'app-v2.0.0',
        kind: 'directory',
        dir: 'app',
        workspacePath: 'apps/app',
        isPublishable: false,
      };
      mockDiscoverWorkspaces.mockReturnValue(resolvedPackages(['packages/basic']));
      mockResolveReleaseTags.mockReturnValue([DIRECTORY_TAG]);

      await createGithubReleaseCommand([], RICH_STYLES, process.cwd());

      expect(console.warn).not.toHaveBeenCalled();
      expect(mockCreateGithubReleases).toHaveBeenCalledWith([DIRECTORY_TAG], '.meta/changelog.json', false, [
        'Bug fixes',
        'Features',
      ]);
    });
  });
});
