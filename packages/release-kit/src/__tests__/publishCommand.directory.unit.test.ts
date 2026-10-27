import type { StreamStyles } from '@williamthorsen/nmr-core';
import { type CapturedStdio, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { silenceConsole, throwOnProcessExit } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  applyPublishCommandDefaults,
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
  resetPublishCommandMocks,
} = await vi.hoisted(() => import('../test-utils/publishCommandMocks.ts'));

vi.mock(import('node:fs'), () => ({
  writeFileSync: mockWriteFileSync,
}));

// Partial, so that `describeEmptyWorkspace` stays the real composer: What a caller does with an empty
// resolution is the subject here, and its wording is covered against the composer itself.
vi.mock(import('../discoverWorkspaces.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  discoverWorkspaces: mockDiscoverWorkspaces,
}));

vi.mock(import('../resolveReleaseTags.ts'), () => ({
  resolveReleaseTags: mockResolveReleaseTags,
}));

vi.mock(import('../deriveWorkspaceConfig.ts'), () => ({
  deriveWorkspaceConfig: mockDeriveWorkspaceConfig,
}));

vi.mock(import('../detectPackageManager.ts'), () => ({
  detectPackageManager: mockDetectPackageManager,
}));

vi.mock(import('../publish.ts'), () => ({
  publishPackage: mockPublishPackage,
}));

vi.mock(import('../loadConfig.ts'), async () => {
  const actual = await vi.importActual<typeof import('../loadConfig.ts')>('../loadConfig.ts');
  return {
    ...actual,
    loadConfig: mockLoadConfig,
    // `node:fs` is mocked above, so the real reader cannot read the root package.json.
    readRootPackageVersion: () => ({ doesExist: true, version: '1.0.0' }),
  };
});

vi.mock(import('../validateConfig.ts'), () => ({
  validateConfig: mockValidateConfig,
}));

vi.mock(import('../createGithubRelease.ts'), () => ({
  createGithubReleases: mockCreateGithubReleases,
}));

vi.mock(import('../injectReleaseNotesIntoReadme.ts'), () => ({
  injectReleaseNotesIntoReadme: mockInjectReleaseNotesIntoReadme,
  resolveReadmePath: mockResolveReadmePath,
}));

vi.mock(import('../assertCleanWorkingTree.ts'), () => ({
  assertCleanWorkingTree: mockAssertCleanWorkingTree,
}));

import { publishCommand } from '../publishCommand.ts';
import { resolvedPackages } from '../test-utils/workspaceResolutions.ts';

const RICH_STYLES: StreamStyles = { stderr: 'rich', stdout: 'rich' };

describe(publishCommand, () => {
  let capture: CapturedStdio;

  beforeEach(() => {
    capture = captureStdio();
    applyPublishCommandDefaults();
    void throwOnProcessExit();
    void silenceConsole(['info', 'warn']);
  });

  afterEach(() => {
    capture[Symbol.dispose]();
    resetPublishCommandMocks();
    vi.restoreAllMocks();
  });

  describe('directory tag', () => {
    it('warns that a directory release is not published when --tags names its tag', async () => {
      mockDiscoverWorkspaces.mockReturnValue(resolvedPackages(['packages/core']));
      mockResolveReleaseTags.mockReturnValue([
        { tag: 'app-v2.0.0', kind: 'directory', dir: 'app', workspacePath: 'apps/app', isPublishable: false },
      ]);

      await publishCommand(['--tags=app-v2.0.0'], RICH_STYLES, process.cwd());

      expect(console.warn).toHaveBeenCalledExactlyOnceWith(
        "Skipping app-v2.0.0: directory release 'app' is not published to a registry.",
      );
      expect(mockPublishPackage).not.toHaveBeenCalled();
    });
  });
});
