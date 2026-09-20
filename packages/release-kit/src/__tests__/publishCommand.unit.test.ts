import type { StreamStyles } from '@williamthorsen/nmr-core';
import { type CapturedStdio, captureError, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { ProcessExitError, silenceConsole, throwOnProcessExit } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockDiscoverWorkspaces = vi.hoisted(() => vi.fn());
const mockResolveReleaseTags = vi.hoisted(() => vi.fn());
const mockDetectPackageManager = vi.hoisted(() => vi.fn());
const mockPublishPackage = vi.hoisted(() => vi.fn());
const mockLoadConfig = vi.hoisted(() => vi.fn());
const mockAssertConfigLoadable = vi.hoisted(() => vi.fn());
const mockValidateConfig = vi.hoisted(() => vi.fn());
const mockCreateGithubReleases = vi.hoisted(() => vi.fn());
const mockInjectReleaseNotesIntoReadme = vi.hoisted(() => vi.fn());
const mockResolveReadmePath = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockDeriveWorkspaceConfig = vi.hoisted(() => vi.fn());
const mockAssertCleanWorkingTree = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  writeFileSync: mockWriteFileSync,
}));

// Partial, so that `describeEmptyWorkspace` stays the real composer: what a caller does with an empty
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
    assertConfigLoadable: mockAssertConfigLoadable,
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
import { resolvedPackages, singlePackage } from '../test-utils/workspaceResolutions.ts';

const RICH_STYLES: StreamStyles = { stderr: 'rich', stdout: 'rich' };

describe(publishCommand, () => {
  let capture: CapturedStdio;

  beforeEach(() => {
    capture = captureStdio();
    mockDiscoverWorkspaces.mockReturnValue(singlePackage());
    mockResolveReleaseTags.mockReturnValue([{ tag: 'v1.0.0', dir: '.', workspacePath: '.', isPublishable: true }]);
    mockDetectPackageManager.mockReturnValue('npm');
    mockLoadConfig.mockResolvedValue(undefined);
    mockAssertConfigLoadable.mockResolvedValue(undefined);
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
        changelogPaths: [workspacePath],
        paths: [`${workspacePath}/**`],
      };
    });
    void throwOnProcessExit();
    void silenceConsole(['info', 'warn']);
  });

  afterEach(() => {
    capture[Symbol.dispose]();
    mockDiscoverWorkspaces.mockReset();
    mockResolveReleaseTags.mockReset();
    mockDetectPackageManager.mockReset();
    mockPublishPackage.mockReset();
    mockLoadConfig.mockReset();
    mockAssertConfigLoadable.mockReset();
    mockValidateConfig.mockReset();
    mockCreateGithubReleases.mockReset();
    mockInjectReleaseNotesIntoReadme.mockReset();
    mockResolveReadmePath.mockReset();
    mockWriteFileSync.mockReset();
    mockDeriveWorkspaceConfig.mockReset();
    mockAssertCleanWorkingTree.mockReset();
    vi.restoreAllMocks();
  });

  it('calls publishPackage for each resolved tag', async () => {
    await publishCommand([], RICH_STYLES);

    expect(mockPublishPackage).toHaveBeenCalledWith(
      { tag: 'v1.0.0', dir: '.', workspacePath: '.', isPublishable: true },
      'npm',
      expect.objectContaining({ dryRun: false, provenance: false }),
    );
  });

  it('passes dryRun when --dry-run is provided', async () => {
    await publishCommand(['--dry-run'], RICH_STYLES);

    expect(mockPublishPackage).toHaveBeenCalledWith(
      expect.anything(),
      'npm',
      expect.objectContaining({ dryRun: true, provenance: false }),
    );
  });

  it('does not thread --no-git-checks into publishPackage options', async () => {
    await publishCommand(['--no-git-checks'], RICH_STYLES);

    expect(mockPublishPackage).toHaveBeenCalledWith(
      expect.anything(),
      'npm',
      expect.objectContaining({ dryRun: false, provenance: false }),
    );
    expect(mockPublishPackage.mock.calls[0]?.[2]).not.toHaveProperty('noGitChecks');
  });

  it('passes provenance when --provenance is provided', async () => {
    await publishCommand(['--provenance'], RICH_STYLES);

    expect(mockPublishPackage).toHaveBeenCalledWith(
      expect.anything(),
      'npm',
      expect.objectContaining({ dryRun: false, provenance: true }),
    );
  });

  it('exits with code 1 on unknown flags', async () => {
    const error = await captureError(ProcessExitError, () => publishCommand(['--unknown'], RICH_STYLES));

    expect(error.code).toBe(1);
    expect(capture.stderrChunks).toContain('Error: Unknown option: --unknown\n');
    expect(mockPublishPackage).not.toHaveBeenCalled();
  });

  it('exits with code 1 when no release tags are found on HEAD', async () => {
    mockResolveReleaseTags.mockReturnValue([]);

    const error = await captureError(ProcessExitError, () => publishCommand([], RICH_STYLES));

    expect(error.code).toBe(1);
    expect(capture.stderrChunks).toContain(
      'Error: No release tags found on HEAD. Create tags with `release-kit tag` first.\n',
    );
  });

  it('filters resolved tags by --tags in monorepo mode', async () => {
    mockDiscoverWorkspaces.mockReturnValue(resolvedPackages(['packages/core', 'packages/release-kit']));
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      { tag: 'release-kit-v2.1.0', dir: 'release-kit', workspacePath: 'packages/release-kit', isPublishable: true },
    ]);

    await publishCommand(['--tags=core-v1.3.0'], RICH_STYLES);

    expect(mockPublishPackage).toHaveBeenCalledTimes(1);
    expect(mockPublishPackage).toHaveBeenCalledWith(
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      'npm',
      expect.objectContaining({ dryRun: false, provenance: false }),
    );
  });

  it('filters resolved tags by --tags in single-package mode', async () => {
    mockDiscoverWorkspaces.mockReturnValue(singlePackage());
    mockResolveReleaseTags.mockReturnValue([{ tag: 'v1.0.0', dir: '.', workspacePath: '.', isPublishable: true }]);

    await publishCommand(['--tags=v1.0.0'], RICH_STYLES);

    expect(mockPublishPackage).toHaveBeenCalledTimes(1);
    expect(mockPublishPackage).toHaveBeenCalledWith(
      { tag: 'v1.0.0', dir: '.', workspacePath: '.', isPublishable: true },
      'npm',
      expect.objectContaining({ dryRun: false, provenance: false }),
    );
  });

  it('exits with code 1 when --tags references an unknown tag', async () => {
    mockDiscoverWorkspaces.mockReturnValue(resolvedPackages(['packages/core']));
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
    ]);

    const error = await captureError(ProcessExitError, () => publishCommand(['--tags=missing-v9.9.9'], RICH_STYLES));

    expect(error.code).toBe(1);
    expect(capture.stderrChunks).toContain('Error: Unknown tag "missing-v9.9.9" in --tags. Available: core-v1.3.0\n');
  });

  it('exits with code 1 when --only is passed (flag removed)', async () => {
    const error = await captureError(ProcessExitError, () => publishCommand(['--only=core'], RICH_STYLES));

    expect(error.code).toBe(1);
    expect(capture.stderrChunks).toContain('Error: Unknown option: --only\n');
  });

  it('exits with code 1 when publishPackage throws', async () => {
    mockPublishPackage.mockImplementation(() => {
      throw new Error('publish failed');
    });

    const error = await captureError(ProcessExitError, () => publishCommand([], RICH_STYLES));

    expect(error.code).toBe(1);
    expect(capture.stderrChunks).toContain('Error: publish failed\n');
  });

  it('does not invoke any GitHub Release path during publish', async () => {
    mockDiscoverWorkspaces.mockReturnValue(resolvedPackages(['packages/core', 'packages/release-kit']));
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      { tag: 'release-kit-v2.1.0', dir: 'release-kit', workspacePath: 'packages/release-kit', isPublishable: true },
    ]);

    await publishCommand([], RICH_STYLES);

    expect(mockCreateGithubReleases).not.toHaveBeenCalled();
  });

  it('uses the detected package manager', async () => {
    mockDetectPackageManager.mockReturnValue('pnpm');

    await publishCommand([], RICH_STYLES);

    expect(mockPublishPackage).toHaveBeenCalledWith(expect.anything(), 'pnpm', expect.anything());
  });

  it('prints confirmation listing before publishing', async () => {
    mockDiscoverWorkspaces.mockReturnValue(resolvedPackages(['packages/core', 'packages/release-kit']));
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      { tag: 'release-kit-v2.1.0', dir: 'release-kit', workspacePath: 'packages/release-kit', isPublishable: true },
    ]);

    await publishCommand([], RICH_STYLES);

    expect(console.info).toHaveBeenCalledWith('Publishing:');
    expect(console.info).toHaveBeenCalledWith('  core-v1.3.0 (packages/core)');
    expect(console.info).toHaveBeenCalledWith('  release-kit-v2.1.0 (packages/release-kit)');
  });

  it('prints dry-run confirmation listing', async () => {
    await publishCommand(['--dry-run'], RICH_STYLES);

    expect(console.info).toHaveBeenCalledWith('[dry-run] Would publish:');
  });

  it('reports successfully published packages when a subsequent publish fails', async () => {
    mockDiscoverWorkspaces.mockReturnValue(resolvedPackages(['packages/core', 'packages/release-kit']));
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      { tag: 'release-kit-v2.1.0', dir: 'release-kit', workspacePath: 'packages/release-kit', isPublishable: true },
    ]);
    mockPublishPackage.mockImplementation((resolvedTag: { tag: string }) => {
      if (resolvedTag.tag === 'release-kit-v2.1.0') {
        throw new Error('publish failed');
      }
    });

    await captureError(ProcessExitError, () => publishCommand([], RICH_STYLES));
    expect(console.warn).toHaveBeenCalledWith('Packages published before failure:');
    expect(console.warn).toHaveBeenCalledWith('  core-v1.3.0');
  });

  describe('config loading', () => {
    it('uses defaults when loadConfig throws', async () => {
      mockLoadConfig.mockRejectedValue(new Error('config read failure'));

      await publishCommand([], RICH_STYLES);

      expect(mockPublishPackage).toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('failed to load config'));
    });

    it('forwards --config to the loader', async () => {
      await publishCommand(['--config', 'elsewhere/alternative.config.ts'], RICH_STYLES);

      expect(mockLoadConfig).toHaveBeenCalledWith('elsewhere/alternative.config.ts');
    });

    it('exits with code 1 for a named config that fails to load before an all-private tag set returns', async () => {
      mockResolveReleaseTags.mockReturnValue([{ tag: 'v1.0.0', dir: '.', workspacePath: '.', isPublishable: false }]);
      mockAssertConfigLoadable.mockRejectedValue(new Error('Config file not found: /repo/elsewhere/absent.config.ts'));

      const error = await captureError(ProcessExitError, () =>
        publishCommand(['--config', 'elsewhere/absent.config.ts'], RICH_STYLES),
      );

      expect(error.code).toBe(1);
      expect(capture.stderr).toContain('Config file not found: /repo/elsewhere/absent.config.ts');
      expect(console.info).not.toHaveBeenCalledWith('Nothing to publish.');
    });

    it('asserts the named config is loadable before resolving tags', async () => {
      await publishCommand(['--config', 'elsewhere/alternative.config.ts'], RICH_STYLES);

      expect(mockAssertConfigLoadable).toHaveBeenCalledWith('elsewhere/alternative.config.ts');
    });

    it('exits with code 1 rather than falling back to defaults when a named config fails to load', async () => {
      mockLoadConfig.mockRejectedValue(new Error('Config file not found: /repo/elsewhere/absent.config.ts'));

      const error = await captureError(ProcessExitError, () =>
        publishCommand(['--config', 'elsewhere/absent.config.ts'], RICH_STYLES),
      );

      expect(error.code).toBe(1);
      expect(capture.stderr).toContain('Config file not found: /repo/elsewhere/absent.config.ts');
      expect(mockPublishPackage).not.toHaveBeenCalled();
    });

    it('prints validation warnings from config', async () => {
      mockLoadConfig.mockResolvedValue({ releaseNotes: {} });
      mockValidateConfig.mockReturnValue({
        config: { releaseNotes: { shouldInjectIntoReadme: true } },
        errors: [],
        warnings: ['releaseNotes.shouldInjectIntoReadme is enabled but changelogJson.enabled is false'],
      });

      await publishCommand([], RICH_STYLES);

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('shouldInjectIntoReadme'));
    });

    it('exits with code 1 when config has validation errors', async () => {
      mockLoadConfig.mockResolvedValue({ bogus: 123 });
      mockValidateConfig.mockReturnValue({
        config: {},
        errors: ["Unknown field: 'bogus'"],
        warnings: [],
      });

      const error = await captureError(ProcessExitError, () => publishCommand([], RICH_STYLES));

      expect(error.code).toBe(1);
      expect(capture.stderrChunks).toContain('Invalid config:\n');
      expect(capture.stderrChunks).toContain("  ❌ Unknown field: 'bogus'\n");
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

      await publishCommand([], RICH_STYLES);

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

      await captureError(ProcessExitError, () => publishCommand([], RICH_STYLES));
      expect(mockWriteFileSync).toHaveBeenCalledWith('/pkg/README.md', '# Original README\n', 'utf8');
    });

    it('skips injection when resolveReadmePath returns undefined', async () => {
      mockResolveReadmePath.mockReturnValue(undefined);

      await publishCommand([], RICH_STYLES);

      expect(mockInjectReleaseNotesIntoReadme).not.toHaveBeenCalled();
      expect(mockPublishPackage).toHaveBeenCalledTimes(1);
    });

    it('skips restore when injectReleaseNotesIntoReadme returns undefined', async () => {
      mockResolveReadmePath.mockReturnValue('/pkg/README.md');
      mockInjectReleaseNotesIntoReadme.mockReturnValue(undefined);

      await publishCommand([], RICH_STYLES);

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

      await publishCommand([], RICH_STYLES);

      expect(mockResolveReadmePath).not.toHaveBeenCalled();
      expect(mockInjectReleaseNotesIntoReadme).not.toHaveBeenCalled();
    });
  });

  describe('publishability filter', () => {
    it('publishes only the publishable subset when implicit resolution mixes publishable and unpublishable tags', async () => {
      mockDiscoverWorkspaces.mockReturnValue(resolvedPackages(['packages/common-utils', 'packages/basic']));
      mockResolveReleaseTags.mockReturnValue([
        {
          tag: 'common-utils-v2.4.0',
          dir: 'common-utils',
          workspacePath: 'packages/common-utils',
          isPublishable: true,
        },
        { tag: 'basic-v1.0.0', dir: 'basic', workspacePath: 'packages/basic', isPublishable: false },
      ]);

      await publishCommand([], RICH_STYLES);

      expect(mockPublishPackage).toHaveBeenCalledTimes(1);
      expect(mockPublishPackage).toHaveBeenCalledWith(
        {
          tag: 'common-utils-v2.4.0',
          dir: 'common-utils',
          workspacePath: 'packages/common-utils',
          isPublishable: true,
        },
        'npm',
        expect.objectContaining({ dryRun: false, provenance: false }),
      );
      // Listing only includes the publishable tag.
      expect(console.info).toHaveBeenCalledWith('  common-utils-v2.4.0 (packages/common-utils)');
      expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining('basic-v1.0.0'));
      // Implicit resolution drops unpublishable tags silently — no warning.
      expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('Skipping'));
    });

    it('exits 0 with "Nothing to publish." when implicit resolution yields zero publishable tags', async () => {
      mockDiscoverWorkspaces.mockReturnValue(resolvedPackages(['packages/basic']));
      mockResolveReleaseTags.mockReturnValue([
        { tag: 'basic-v1.0.0', dir: 'basic', workspacePath: 'packages/basic', isPublishable: false },
      ]);

      await publishCommand([], RICH_STYLES);

      expect(console.info).toHaveBeenCalledWith('Nothing to publish.');
      expect(mockPublishPackage).not.toHaveBeenCalled();
    });

    it('skips with a warning and publishes nothing when explicit --tags names an unpublishable tag', async () => {
      mockDiscoverWorkspaces.mockReturnValue(resolvedPackages(['packages/basic']));
      mockResolveReleaseTags.mockReturnValue([
        { tag: 'basic-v1.0.0', dir: 'basic', workspacePath: 'packages/basic', isPublishable: false },
      ]);

      await publishCommand(['--tags=basic-v1.0.0'], RICH_STYLES);

      // Explicit naming of an unpublishable tag warns and skips rather than exiting non-zero.
      expect(console.warn).toHaveBeenCalledWith(
        'Skipping basic-v1.0.0 (packages/basic): package.json#private is true.',
      );
      expect(console.info).toHaveBeenCalledWith('Nothing to publish.');
      expect(mockPublishPackage).not.toHaveBeenCalled();
    });

    it('warns for every unpublishable tag when explicit --tags names multiple unpublishable tags', async () => {
      mockDiscoverWorkspaces.mockReturnValue(resolvedPackages(['packages/basic', 'packages/internal']));
      mockResolveReleaseTags.mockReturnValue([
        { tag: 'basic-v1.0.0', dir: 'basic', workspacePath: 'packages/basic', isPublishable: false },
        { tag: 'internal-v2.0.0', dir: 'internal', workspacePath: 'packages/internal', isPublishable: false },
      ]);

      await publishCommand(['--tags=basic-v1.0.0,internal-v2.0.0'], RICH_STYLES);

      expect(console.warn).toHaveBeenCalledWith(
        'Skipping basic-v1.0.0 (packages/basic): package.json#private is true.',
      );
      expect(console.warn).toHaveBeenCalledWith(
        'Skipping internal-v2.0.0 (packages/internal): package.json#private is true.',
      );
      expect(console.info).toHaveBeenCalledWith('Nothing to publish.');
      expect(mockPublishPackage).not.toHaveBeenCalled();
    });

    it('publishes the publishable subset and warns past the private tag when explicit --tags mixes both', async () => {
      mockDiscoverWorkspaces.mockReturnValue(resolvedPackages(['packages/common-utils', 'packages/basic']));
      mockResolveReleaseTags.mockReturnValue([
        {
          tag: 'common-utils-v2.4.0',
          dir: 'common-utils',
          workspacePath: 'packages/common-utils',
          isPublishable: true,
        },
        { tag: 'basic-v1.0.0', dir: 'basic', workspacePath: 'packages/basic', isPublishable: false },
      ]);

      await publishCommand(['--tags=common-utils-v2.4.0,basic-v1.0.0'], RICH_STYLES);

      // The private tag is skipped with a warning; the publishable tag still publishes.
      expect(console.warn).toHaveBeenCalledWith(
        'Skipping basic-v1.0.0 (packages/basic): package.json#private is true.',
      );
      expect(mockPublishPackage).toHaveBeenCalledTimes(1);
      expect(mockPublishPackage).toHaveBeenCalledWith(
        {
          tag: 'common-utils-v2.4.0',
          dir: 'common-utils',
          workspacePath: 'packages/common-utils',
          isPublishable: true,
        },
        'npm',
        expect.objectContaining({ dryRun: false, provenance: false }),
      );
    });
  });

  describe('clean-tree gate', () => {
    it('exits with error when the working tree is dirty', async () => {
      mockAssertCleanWorkingTree.mockImplementation(() => {
        throw new Error('Working tree has uncommitted changes.');
      });

      const error = await captureError(ProcessExitError, () => publishCommand([], RICH_STYLES));

      expect(error.code).toBe(1);
      expect(capture.stderr).toContain('uncommitted changes');
      expect(mockResolveReleaseTags).not.toHaveBeenCalled();
      expect(mockPublishPackage).not.toHaveBeenCalled();
    });

    it('proceeds when the working tree is clean', async () => {
      await publishCommand([], RICH_STYLES);

      expect(mockAssertCleanWorkingTree).toHaveBeenCalledTimes(1);
      expect(mockPublishPackage).toHaveBeenCalledTimes(1);
    });

    it('skips the check when --no-git-checks is provided', async () => {
      await publishCommand(['--no-git-checks'], RICH_STYLES);

      expect(mockAssertCleanWorkingTree).not.toHaveBeenCalled();
      expect(mockPublishPackage).toHaveBeenCalledTimes(1);
    });

    it('skips the check when --dry-run is provided', async () => {
      await publishCommand(['--dry-run'], RICH_STYLES);

      expect(mockAssertCleanWorkingTree).not.toHaveBeenCalled();
      expect(mockPublishPackage).toHaveBeenCalledTimes(1);
    });
  });
});
