import { formatStatusLine, type StreamStyles, UserError } from '@williamthorsen/nmr-core';
import { type CapturedStdio, captureError, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { listConsoleLines, silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
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

const mockAssertTarballsComplete = vi.hoisted(() => vi.fn());

// Packing from a clean checkout needs an installable repo, which these fixtures are not; the check is covered on its own.
vi.mock(import('../assertTarballsComplete.ts'), () => ({
  assertTarballsComplete: mockAssertTarballsComplete,
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

import { ConfigProblemError } from '../loadValidatedConfig.ts';
import { publishCommand } from '../publishCommand.ts';
import { makePublishOptions } from '../test-utils/commandOptions.ts';
import { makeResolvedPackages } from '../test-utils/workspaceResolutions.ts';

const PLAIN_STYLES: StreamStyles = { stderr: 'plain', stdout: 'plain' };
const RICH_STYLES: StreamStyles = { stderr: 'rich', stdout: 'rich' };

describe(publishCommand, () => {
  let stdioCapture: CapturedStdio;

  beforeEach(() => {
    stdioCapture = captureStdio();
    applyPublishCommandDefaults();
  });

  afterEach(() => {
    stdioCapture[Symbol.dispose]();
    resetPublishCommandMocks();
    mockAssertTarballsComplete.mockReset();
    vi.restoreAllMocks();
  });

  describe('config loading', () => {
    it('passes the configured development conditions to the tarball check', async () => {
      const config = { devExportConditions: ['nmr-source'] };
      mockLoadConfig.mockResolvedValue(config);
      mockValidateConfig.mockReturnValue({ config, errors: [], warnings: [] });

      await publishCommand(makePublishOptions({ styles: RICH_STYLES }));

      expect(mockAssertTarballsComplete).toHaveBeenCalledWith(expect.any(Array), ['nmr-source']);
    });

    it('forwards --config to the loader', async () => {
      await publishCommand(
        makePublishOptions({ configPath: '/invoked/from/elsewhere/alternative.config.ts', styles: RICH_STYLES }),
      );

      expect(mockLoadConfig).toHaveBeenCalledExactlyOnceWith('/invoked/from/elsewhere/alternative.config.ts');
    });

    it('does not publish an excluded workspace and reports the skip', async () => {
      using silent = silenceConsole(['warn']);
      mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core', 'packages/legacy']));
      mockResolveReleaseTags.mockReturnValue([
        { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
        { tag: 'legacy-v0.9.0', kind: 'package', dir: 'legacy', workspacePath: 'packages/legacy', isPublishable: true },
      ]);
      const config = { workspaces: [{ dir: 'legacy', shouldExclude: true }] };
      mockLoadConfig.mockResolvedValue(config);
      mockValidateConfig.mockReturnValue({ config, errors: [], warnings: [] });

      await publishCommand(makePublishOptions({ styles: RICH_STYLES }));

      expect(listConsoleLines(silent.warn)).toContain(
        'Skipping legacy-v0.9.0 (packages/legacy): excluded by config (shouldExclude: true).',
      );
      expect(mockPublishPackage).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ tag: 'core-v1.3.0' }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('exits with code 1 for a named config that fails to load before an all-private tag set returns', async () => {
      using silent = silenceConsole(['info']);
      mockResolveReleaseTags.mockReturnValue([
        { tag: 'v1.0.0', kind: 'package', dir: '.', workspacePath: '.', isPublishable: false },
      ]);
      mockLoadConfig.mockRejectedValue(new Error('Config file not found: /repo/elsewhere/absent.config.ts'));

      const error = await captureError(ConfigProblemError, () =>
        publishCommand(makePublishOptions({ configPath: '/repo/elsewhere/absent.config.ts', styles: RICH_STYLES })),
      );

      expect(error.problem).toStrictEqual({
        kind: 'load',
        message: 'Config file not found: /repo/elsewhere/absent.config.ts',
      });
      expect(listConsoleLines(silent.info)).not.toContain('Nothing to publish.');
    });

    it('exits with code 1 for a default config that fails to load before an all-private tag set returns', async () => {
      using silent = silenceConsole(['info']);
      mockResolveReleaseTags.mockReturnValue([
        { tag: 'v1.0.0', kind: 'package', dir: '.', workspacePath: '.', isPublishable: false },
      ]);
      mockLoadConfig.mockRejectedValue(new Error('Unexpected token in config'));

      const error = await captureError(ConfigProblemError, () =>
        publishCommand(makePublishOptions({ styles: RICH_STYLES })),
      );

      expect(error.problem).toStrictEqual({ kind: 'load', message: 'Unexpected token in config' });
      expect(listConsoleLines(silent.info)).not.toContain('Nothing to publish.');
    });

    it('exits with code 1 for an invalid default config before an all-private tag set returns', async () => {
      using silent = silenceConsole(['info']);
      mockResolveReleaseTags.mockReturnValue([
        { tag: 'v1.0.0', kind: 'package', dir: '.', workspacePath: '.', isPublishable: false },
      ]);
      mockLoadConfig.mockResolvedValue({ bogus: 123 });
      mockValidateConfig.mockReturnValue({ config: {}, errors: ["Unknown field: 'bogus'"], warnings: [] });

      const error = await captureError(ConfigProblemError, () =>
        publishCommand(makePublishOptions({ styles: RICH_STYLES })),
      );

      expect(error.problem.kind).toBe('validation');
      expect(listConsoleLines(silent.info)).not.toContain('Nothing to publish.');
    });

    it('stays a clean no-op when the default config does not exist and every tag is private', async () => {
      using silent = silenceConsole(['info']);
      mockResolveReleaseTags.mockReturnValue([
        { tag: 'v1.0.0', kind: 'package', dir: '.', workspacePath: '.', isPublishable: false },
      ]);

      await publishCommand(makePublishOptions({ styles: RICH_STYLES }));

      expect(listConsoleLines(silent.info)).toContain('Nothing to publish.');
      expect(stdioCapture.stderr).toBe('');
      expect(mockPublishPackage).not.toHaveBeenCalled();
    });

    it('exits with code 1 rather than falling back to defaults when a named config fails to load', async () => {
      mockLoadConfig.mockRejectedValue(new Error('Config file not found: /repo/elsewhere/absent.config.ts'));

      const error = await captureError(ConfigProblemError, () =>
        publishCommand(makePublishOptions({ configPath: '/repo/elsewhere/absent.config.ts', styles: RICH_STYLES })),
      );

      expect(error.problem).toStrictEqual({
        kind: 'load',
        message: 'Config file not found: /repo/elsewhere/absent.config.ts',
      });
      expect(mockPublishPackage).not.toHaveBeenCalled();
    });

    it('exits with code 1 rather than falling back to defaults when the default config fails to load', async () => {
      mockLoadConfig.mockRejectedValue(new Error('Unexpected token in config'));

      const error = await captureError(ConfigProblemError, () =>
        publishCommand(makePublishOptions({ styles: RICH_STYLES })),
      );

      expect(error.problem).toStrictEqual({ kind: 'load', message: 'Unexpected token in config' });
      expect(mockPublishPackage).not.toHaveBeenCalled();
    });

    it('prints validation warnings from config', async () => {
      using silent = silenceConsole(['warn']);
      mockLoadConfig.mockResolvedValue({ releaseNotes: {} });
      mockValidateConfig.mockReturnValue({
        config: { releaseNotes: { shouldInjectIntoReadme: true } },
        errors: [],
        warnings: ['releaseNotes.shouldInjectIntoReadme is enabled but changelogJson.enabled is false'],
      });

      await publishCommand(makePublishOptions({ styles: RICH_STYLES }));

      expect(mockLoadConfig).toHaveBeenCalledTimes(1);
      expect(listConsoleLines(silent.warn)).toStrictEqual([expect.stringContaining('shouldInjectIntoReadme')]);
    });

    it('exits with code 1 when config has validation errors', async () => {
      mockLoadConfig.mockResolvedValue({ bogus: 123 });
      mockValidateConfig.mockReturnValue({
        config: {},
        errors: ["Unknown field: 'bogus'"],
        warnings: [],
      });

      const error = await captureError(ConfigProblemError, () =>
        publishCommand(makePublishOptions({ styles: RICH_STYLES })),
      );

      expect(error.problem).toStrictEqual({ kind: 'validation', errors: ["Unknown field: 'bogus'"] });
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
      mockInjectReleaseNotesIntoReadme.mockReturnValue({ status: 'injected', originalReadme: '# Original README\n' });

      await publishCommand(makePublishOptions({ styles: RICH_STYLES }));

      expect(mockInjectReleaseNotesIntoReadme).toHaveBeenCalledTimes(1);
      expect(mockPublishPackage).toHaveBeenCalledTimes(1);
      expect(mockWriteFileSync).toHaveBeenCalledWith('/pkg/README.md', '# Original README\n', 'utf8');
    });

    it('restores README when publishPackage throws', async () => {
      mockResolveReadmePath.mockReturnValue('/pkg/README.md');
      mockInjectReleaseNotesIntoReadme.mockReturnValue({ status: 'injected', originalReadme: '# Original README\n' });
      mockPublishPackage.mockImplementation(() => {
        throw new UserError('publish failed');
      });

      await captureError(UserError, () => publishCommand(makePublishOptions({ styles: RICH_STYLES })));
      expect(mockWriteFileSync).toHaveBeenCalledWith('/pkg/README.md', '# Original README\n', 'utf8');
    });

    it('skips injection when resolveReadmePath returns undefined', async () => {
      mockResolveReadmePath.mockReturnValue(undefined);

      await publishCommand(makePublishOptions({ styles: RICH_STYLES }));

      expect(mockInjectReleaseNotesIntoReadme).not.toHaveBeenCalled();
      expect(mockPublishPackage).toHaveBeenCalledTimes(1);
    });

    it('skips restore and still publishes when injection is skipped', async () => {
      mockResolveReadmePath.mockReturnValue('/pkg/README.md');
      mockInjectReleaseNotesIntoReadme.mockReturnValue({ status: 'skipped', skip: { reason: 'missing-file' } });

      await publishCommand(makePublishOptions({ styles: RICH_STYLES }));

      expect(mockInjectReleaseNotesIntoReadme).toHaveBeenCalledTimes(1);
      expect(mockPublishPackage).toHaveBeenCalledTimes(1);
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it.each([
      [{ reason: 'missing-file' }, '.meta/changelog.json not found'],
      [{ reason: 'unreadable-file' }, 'could not parse .meta/changelog.json'],
      [{ reason: 'no-entry', version: '1.0.0' }, 'no changelog entry for version 1.0.0'],
      [{ reason: 'empty-body', version: '1.0.0' }, 'no user-facing release notes for version 1.0.0'],
    ])('warns on stderr, naming the tag, the workspace, and the reason, for a %o skip', async (skip, reasonText) => {
      using silent = silenceConsole(['warn']);
      mockResolveReadmePath.mockReturnValue('/pkg/README.md');
      mockInjectReleaseNotesIntoReadme.mockReturnValue({ status: 'skipped', skip });

      await publishCommand(makePublishOptions({ styles: PLAIN_STYLES }));

      expect(listConsoleLines(silent.warn)).toContain(
        `  ${formatStatusLine('plain', 'warning', `Skipping README injection for v1.0.0 (.): ${reasonText}`)}`,
      );
    });

    it('skips injection when shouldInjectIntoReadme is false', async () => {
      mockValidateConfig.mockReturnValue({
        config: {
          releaseNotes: { shouldInjectIntoReadme: false },
        },
        errors: [],
        warnings: [],
      });

      await publishCommand(makePublishOptions({ styles: RICH_STYLES }));

      expect(mockResolveReadmePath).not.toHaveBeenCalled();
      expect(mockInjectReleaseNotesIntoReadme).not.toHaveBeenCalled();
    });
  });
});
