import type { StreamStyles } from '@williamthorsen/nmr-core';
import { type CapturedStdio, captureError, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { ProcessExitError, silenceConsole, throwOnProcessExit } from '@williamthorsen/toolbelt.vitest/candidate';
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

// Packing from a clean checkout needs an installable repo, which these fixtures are not; the check is covered on its own.
vi.mock(import('../assertTarballsComplete.ts'), () => ({
  assertTarballsComplete: vi.fn(),
}));

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
  const actualModule = await vi.importActual<typeof import('../loadConfig.ts')>('../loadConfig.ts');
  return {
    ...actualModule,
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
import { makeResolvedPackages } from '../test-utils/workspaceResolutions.ts';

const RICH_STYLES: StreamStyles = { stderr: 'rich', stdout: 'rich' };

describe(publishCommand, () => {
  let stdioCapture: CapturedStdio;

  beforeEach(() => {
    stdioCapture = captureStdio();
    applyPublishCommandDefaults();
    void throwOnProcessExit();
    void silenceConsole(['info', 'warn']);
  });

  afterEach(() => {
    stdioCapture[Symbol.dispose]();
    resetPublishCommandMocks();
    vi.restoreAllMocks();
  });

  describe('config loading', () => {
    it('forwards --config to the loader resolved against the invocation directory', async () => {
      await publishCommand(['--config', 'elsewhere/alternative.config.ts'], RICH_STYLES, '/invoked/from');

      expect(mockLoadConfig).toHaveBeenCalledExactlyOnceWith('/invoked/from/elsewhere/alternative.config.ts');
    });

    it('does not publish an excluded workspace and reports the skip', async () => {
      mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core', 'packages/legacy']));
      mockResolveReleaseTags.mockReturnValue([
        { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
        { tag: 'legacy-v0.9.0', kind: 'package', dir: 'legacy', workspacePath: 'packages/legacy', isPublishable: true },
      ]);
      const config = { workspaces: [{ dir: 'legacy', shouldExclude: true }] };
      mockLoadConfig.mockResolvedValue(config);
      mockValidateConfig.mockReturnValue({ config, errors: [], warnings: [] });

      await publishCommand([], RICH_STYLES, process.cwd());

      expect(console.warn).toHaveBeenCalledWith(
        'Skipping legacy-v0.9.0 (packages/legacy): excluded by config (shouldExclude: true).',
      );
      expect(mockPublishPackage).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ tag: 'core-v1.3.0' }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('exits with code 1 for a named config that fails to load before an all-private tag set returns', async () => {
      mockResolveReleaseTags.mockReturnValue([
        { tag: 'v1.0.0', kind: 'package', dir: '.', workspacePath: '.', isPublishable: false },
      ]);
      mockLoadConfig.mockRejectedValue(new Error('Config file not found: /repo/elsewhere/absent.config.ts'));

      const error = await captureError(ProcessExitError, () =>
        publishCommand(['--config', 'elsewhere/absent.config.ts'], RICH_STYLES, process.cwd()),
      );

      expect(error.code).toBe(1);
      expect(stdioCapture.stderr).toContain('Config file not found: /repo/elsewhere/absent.config.ts');
      expect(console.info).not.toHaveBeenCalledWith('Nothing to publish.');
    });

    it('exits with code 1 for a default config that fails to load before an all-private tag set returns', async () => {
      mockResolveReleaseTags.mockReturnValue([
        { tag: 'v1.0.0', kind: 'package', dir: '.', workspacePath: '.', isPublishable: false },
      ]);
      mockLoadConfig.mockRejectedValue(new Error('Unexpected token in config'));

      const error = await captureError(ProcessExitError, () => publishCommand([], RICH_STYLES, process.cwd()));

      expect(error.code).toBe(1);
      expect(stdioCapture.stderrChunks).toContain('Error: Failed to load config: Unexpected token in config\n');
      expect(console.info).not.toHaveBeenCalledWith('Nothing to publish.');
    });

    it('exits with code 1 for an invalid default config before an all-private tag set returns', async () => {
      mockResolveReleaseTags.mockReturnValue([
        { tag: 'v1.0.0', kind: 'package', dir: '.', workspacePath: '.', isPublishable: false },
      ]);
      mockLoadConfig.mockResolvedValue({ bogus: 123 });
      mockValidateConfig.mockReturnValue({ config: {}, errors: ["Unknown field: 'bogus'"], warnings: [] });

      const error = await captureError(ProcessExitError, () => publishCommand([], RICH_STYLES, process.cwd()));

      expect(error.code).toBe(1);
      expect(stdioCapture.stderrChunks).toContain('Invalid config:\n');
      expect(console.info).not.toHaveBeenCalledWith('Nothing to publish.');
    });

    it('stays a clean no-op when the default config does not exist and every tag is private', async () => {
      mockResolveReleaseTags.mockReturnValue([
        { tag: 'v1.0.0', kind: 'package', dir: '.', workspacePath: '.', isPublishable: false },
      ]);

      await publishCommand([], RICH_STYLES, process.cwd());

      expect(console.info).toHaveBeenCalledWith('Nothing to publish.');
      expect(stdioCapture.stderr).toBe('');
      expect(mockPublishPackage).not.toHaveBeenCalled();
    });

    it('exits with code 1 rather than falling back to defaults when a named config fails to load', async () => {
      mockLoadConfig.mockRejectedValue(new Error('Config file not found: /repo/elsewhere/absent.config.ts'));

      const error = await captureError(ProcessExitError, () =>
        publishCommand(['--config', 'elsewhere/absent.config.ts'], RICH_STYLES, process.cwd()),
      );

      expect(error.code).toBe(1);
      expect(stdioCapture.stderr).toContain('Config file not found: /repo/elsewhere/absent.config.ts');
      expect(mockPublishPackage).not.toHaveBeenCalled();
    });

    it('exits with code 1 rather than falling back to defaults when the default config fails to load', async () => {
      mockLoadConfig.mockRejectedValue(new Error('Unexpected token in config'));

      const error = await captureError(ProcessExitError, () => publishCommand([], RICH_STYLES, process.cwd()));

      expect(error.code).toBe(1);
      expect(stdioCapture.stderrChunks).toContain('Error: Failed to load config: Unexpected token in config\n');
      expect(mockPublishPackage).not.toHaveBeenCalled();
    });

    it('prints validation warnings from config', async () => {
      mockLoadConfig.mockResolvedValue({ releaseNotes: {} });
      mockValidateConfig.mockReturnValue({
        config: { releaseNotes: { shouldInjectIntoReadme: true } },
        errors: [],
        warnings: ['releaseNotes.shouldInjectIntoReadme is enabled but changelogJson.enabled is false'],
      });

      await publishCommand([], RICH_STYLES, process.cwd());

      expect(mockLoadConfig).toHaveBeenCalledTimes(1);
      expect(console.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('shouldInjectIntoReadme'));
    });

    it('exits with code 1 when config has validation errors', async () => {
      mockLoadConfig.mockResolvedValue({ bogus: 123 });
      mockValidateConfig.mockReturnValue({
        config: {},
        errors: ["Unknown field: 'bogus'"],
        warnings: [],
      });

      const error = await captureError(ProcessExitError, () => publishCommand([], RICH_STYLES, process.cwd()));

      expect(error.code).toBe(1);
      expect(stdioCapture.stderrChunks).toContain('Invalid config:\n');
      expect(stdioCapture.stderrChunks).toContain("  ❌ Unknown field: 'bogus'\n");
      expect(mockPublishPackage).not.toHaveBeenCalled();
    });
  });

  describe('README injection lifecycle', () => {
    beforeEach(() => {
      mockLoadConfig.mockResolvedValue({ releaseNotes: {} });
      mockValidateConfig.mockReturnValue({
        config: {
          releaseNotes: { shouldInjectIntoReadme: true },
        },
        errors: [],
        warnings: [],
      });
    });

    it('injects before publish and restores after', async () => {
      mockResolveReadmePath.mockReturnValue('/pkg/README.md');
      mockInjectReleaseNotesIntoReadme.mockReturnValue('# Original README\n');

      await publishCommand([], RICH_STYLES, process.cwd());

      expect(mockInjectReleaseNotesIntoReadme).toHaveBeenCalledTimes(1);
      expect(mockPublishPackage).toHaveBeenCalledTimes(1);
      expect(mockWriteFileSync).toHaveBeenCalledWith('/pkg/README.md', '# Original README\n', 'utf8');
    });

    it('restores README when publishPackage throws', async () => {
      mockResolveReadmePath.mockReturnValue('/pkg/README.md');
      mockInjectReleaseNotesIntoReadme.mockReturnValue('# Original README\n');
      mockPublishPackage.mockImplementation(() => {
        throw new Error('publish failed');
      });

      await captureError(ProcessExitError, () => publishCommand([], RICH_STYLES, process.cwd()));
      expect(mockWriteFileSync).toHaveBeenCalledWith('/pkg/README.md', '# Original README\n', 'utf8');
    });

    it('skips injection when resolveReadmePath returns undefined', async () => {
      mockResolveReadmePath.mockReturnValue(undefined);

      await publishCommand([], RICH_STYLES, process.cwd());

      expect(mockInjectReleaseNotesIntoReadme).not.toHaveBeenCalled();
      expect(mockPublishPackage).toHaveBeenCalledTimes(1);
    });

    it('skips restore when injectReleaseNotesIntoReadme returns undefined', async () => {
      mockResolveReadmePath.mockReturnValue('/pkg/README.md');
      mockInjectReleaseNotesIntoReadme.mockReturnValue(undefined);

      await publishCommand([], RICH_STYLES, process.cwd());

      expect(mockInjectReleaseNotesIntoReadme).toHaveBeenCalledTimes(1);
      expect(mockPublishPackage).toHaveBeenCalledTimes(1);
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('skips injection when shouldInjectIntoReadme is false', async () => {
      mockValidateConfig.mockReturnValue({
        config: {
          releaseNotes: { shouldInjectIntoReadme: false },
        },
        errors: [],
        warnings: [],
      });

      await publishCommand([], RICH_STYLES, process.cwd());

      expect(mockResolveReadmePath).not.toHaveBeenCalled();
      expect(mockInjectReleaseNotesIntoReadme).not.toHaveBeenCalled();
    });
  });
});
