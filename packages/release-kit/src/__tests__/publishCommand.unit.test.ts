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

const mockAssertTarballsComplete = vi.hoisted(() => vi.fn());

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

import { publishCommand } from '../publishCommand.ts';
import { makeResolvedPackages, makeSinglePackage } from '../test-utils/workspaceResolutions.ts';

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
    mockAssertTarballsComplete.mockReset();
    vi.restoreAllMocks();
  });

  it('calls publishPackage for each resolved tag', async () => {
    await publishCommand([], RICH_STYLES, process.cwd());

    expect(mockPublishPackage).toHaveBeenCalledWith(
      { tag: 'v1.0.0', kind: 'package', dir: '.', workspacePath: '.', isPublishable: true },
      'npm',
      expect.objectContaining({ isDryRun: false, shouldGenerateProvenance: false }),
    );
  });

  it('passes isDryRun when --dry-run is provided', async () => {
    await publishCommand(['--dry-run'], RICH_STYLES, process.cwd());

    expect(mockPublishPackage).toHaveBeenCalledWith(
      expect.anything(),
      'npm',
      expect.objectContaining({ isDryRun: true, shouldGenerateProvenance: false }),
    );
  });

  it('does not pass --no-git-checks into publishPackage options', async () => {
    await publishCommand(['--no-git-checks'], RICH_STYLES, process.cwd());

    expect(mockPublishPackage).toHaveBeenCalledWith(
      expect.anything(),
      'npm',
      expect.objectContaining({ isDryRun: false, shouldGenerateProvenance: false }),
    );
    expect(mockPublishPackage.mock.calls[0]?.[2]).not.toHaveProperty('shouldSkipGitChecks');
  });

  it('passes provenance when --provenance is provided', async () => {
    await publishCommand(['--provenance'], RICH_STYLES, process.cwd());

    expect(mockPublishPackage).toHaveBeenCalledWith(
      expect.anything(),
      'npm',
      expect.objectContaining({ isDryRun: false, shouldGenerateProvenance: true }),
    );
  });

  it('exits with code 1 on unknown flags', async () => {
    const error = await captureError(ProcessExitError, () => publishCommand(['--unknown'], RICH_STYLES, process.cwd()));

    expect(error.code).toBe(1);
    expect(stdioCapture.stderrChunks).toContain('Error: Unknown option: --unknown\n');
    expect(mockPublishPackage).not.toHaveBeenCalled();
  });

  it('exits with code 1 when it does not find any release tags on HEAD', async () => {
    mockResolveReleaseTags.mockReturnValue([]);

    const error = await captureError(ProcessExitError, () => publishCommand([], RICH_STYLES, process.cwd()));

    expect(error.code).toBe(1);
    expect(stdioCapture.stderrChunks).toContain(
      'Error: HEAD does not have any release tags. Create tags with `release-kit tag` first.\n',
    );
  });

  it('filters resolved tags by --tags in monorepo mode', async () => {
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core', 'packages/release-kit']));
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      {
        tag: 'release-kit-v2.1.0',
        kind: 'package',
        dir: 'release-kit',
        workspacePath: 'packages/release-kit',
        isPublishable: true,
      },
    ]);

    await publishCommand(['--tags=core-v1.3.0'], RICH_STYLES, process.cwd());

    expect(mockPublishPackage).toHaveBeenCalledTimes(1);
    expect(mockPublishPackage).toHaveBeenCalledWith(
      { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      'npm',
      expect.objectContaining({ isDryRun: false, shouldGenerateProvenance: false }),
    );
  });

  it('filters resolved tags by --tags in single-package mode', async () => {
    mockDiscoverWorkspaces.mockReturnValue(makeSinglePackage());
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'v1.0.0', kind: 'package', dir: '.', workspacePath: '.', isPublishable: true },
    ]);

    await publishCommand(['--tags=v1.0.0'], RICH_STYLES, process.cwd());

    expect(mockPublishPackage).toHaveBeenCalledTimes(1);
    expect(mockPublishPackage).toHaveBeenCalledWith(
      { tag: 'v1.0.0', kind: 'package', dir: '.', workspacePath: '.', isPublishable: true },
      'npm',
      expect.objectContaining({ isDryRun: false, shouldGenerateProvenance: false }),
    );
  });

  it('exits with code 1 when --tags references an unknown tag', async () => {
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core']));
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
    ]);

    const error = await captureError(ProcessExitError, () =>
      publishCommand(['--tags=missing-v9.9.9'], RICH_STYLES, process.cwd()),
    );

    expect(error.code).toBe(1);
    expect(stdioCapture.stderrChunks).toContain(
      'Error: Unknown tag "missing-v9.9.9" in --tags. Available: core-v1.3.0\n',
    );
  });

  it('exits with code 1 when --only is passed (flag removed)', async () => {
    const error = await captureError(ProcessExitError, () =>
      publishCommand(['--only=core'], RICH_STYLES, process.cwd()),
    );

    expect(error.code).toBe(1);
    expect(stdioCapture.stderrChunks).toContain('Error: Unknown option: --only\n');
  });

  it('checks the tarballs of the publishable tags', async () => {
    await publishCommand([], RICH_STYLES, process.cwd());

    expect(mockAssertTarballsComplete).toHaveBeenCalledWith(['.'], []);
  });

  it('exits with code 1 without publishing when a tarball lacks a manifest file', async () => {
    mockAssertTarballsComplete.mockImplementation(() => {
      throw new Error('Cannot release: The tarball of every package must contain each file that its manifest names.');
    });

    const error = await captureError(ProcessExitError, () => publishCommand([], RICH_STYLES, process.cwd()));

    expect(error.code).toBe(1);
    expect(stdioCapture.stderr).toContain('must contain each file that its manifest names');
    expect(mockPublishPackage).not.toHaveBeenCalled();
  });

  it('exits with code 1 when publishPackage throws', async () => {
    mockPublishPackage.mockImplementation(() => {
      throw new Error('publish failed');
    });

    const error = await captureError(ProcessExitError, () => publishCommand([], RICH_STYLES, process.cwd()));

    expect(error.code).toBe(1);
    expect(stdioCapture.stderrChunks).toContain('Error: publish failed\n');
  });

  it('does not invoke any GitHub Release path during publish', async () => {
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core', 'packages/release-kit']));
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      {
        tag: 'release-kit-v2.1.0',
        kind: 'package',
        dir: 'release-kit',
        workspacePath: 'packages/release-kit',
        isPublishable: true,
      },
    ]);

    await publishCommand([], RICH_STYLES, process.cwd());

    expect(mockCreateGithubReleases).not.toHaveBeenCalled();
  });

  it('uses the detected package manager', async () => {
    mockDetectPackageManager.mockReturnValue('pnpm');

    await publishCommand([], RICH_STYLES, process.cwd());

    expect(mockPublishPackage).toHaveBeenCalledWith(expect.anything(), 'pnpm', expect.anything());
  });

  it('prints confirmation listing before publishing', async () => {
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core', 'packages/release-kit']));
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      {
        tag: 'release-kit-v2.1.0',
        kind: 'package',
        dir: 'release-kit',
        workspacePath: 'packages/release-kit',
        isPublishable: true,
      },
    ]);

    await publishCommand([], RICH_STYLES, process.cwd());

    expect(console.info).toHaveBeenCalledWith('Publishing:');
    expect(console.info).toHaveBeenCalledWith('  core-v1.3.0 (packages/core)');
    expect(console.info).toHaveBeenCalledWith('  release-kit-v2.1.0 (packages/release-kit)');
  });

  it('prints dry-run confirmation listing', async () => {
    await publishCommand(['--dry-run'], RICH_STYLES, process.cwd());

    expect(console.info).toHaveBeenCalledWith('[dry-run] Would publish:');
  });

  it('reports successfully published packages when a subsequent publish fails', async () => {
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core', 'packages/release-kit']));
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      {
        tag: 'release-kit-v2.1.0',
        kind: 'package',
        dir: 'release-kit',
        workspacePath: 'packages/release-kit',
        isPublishable: true,
      },
    ]);
    mockPublishPackage.mockImplementation((resolvedTag: { tag: string }) => {
      if (resolvedTag.tag === 'release-kit-v2.1.0') {
        throw new Error('publish failed');
      }
    });

    await captureError(ProcessExitError, () => publishCommand([], RICH_STYLES, process.cwd()));
    expect(console.warn).toHaveBeenCalledWith('Packages published before failure:');
    expect(console.warn).toHaveBeenCalledWith('  core-v1.3.0');
  });

  describe('publishability filter', () => {
    it('publishes only the publishable subset when implicit resolution mixes publishable and unpublishable tags', async () => {
      mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/common-utils', 'packages/basic']));
      mockResolveReleaseTags.mockReturnValue([
        {
          tag: 'common-utils-v2.4.0',
          dir: 'common-utils',
          workspacePath: 'packages/common-utils',
          isPublishable: true,
        },
        { tag: 'basic-v1.0.0', kind: 'package', dir: 'basic', workspacePath: 'packages/basic', isPublishable: false },
      ]);

      await publishCommand([], RICH_STYLES, process.cwd());

      expect(mockPublishPackage).toHaveBeenCalledTimes(1);
      expect(mockPublishPackage).toHaveBeenCalledWith(
        {
          tag: 'common-utils-v2.4.0',
          dir: 'common-utils',
          workspacePath: 'packages/common-utils',
          isPublishable: true,
        },
        'npm',
        expect.objectContaining({ isDryRun: false, shouldGenerateProvenance: false }),
      );
      expect(console.info).toHaveBeenCalledWith('  common-utils-v2.4.0 (packages/common-utils)');
      expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining('basic-v1.0.0'));
      // Implicit resolution drops an unpublishable tag without a warning.
      expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('Skipping'));
    });

    it('exits 0 with "Nothing to publish." when implicit resolution yields zero publishable tags', async () => {
      mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/basic']));
      mockResolveReleaseTags.mockReturnValue([
        { tag: 'basic-v1.0.0', kind: 'package', dir: 'basic', workspacePath: 'packages/basic', isPublishable: false },
      ]);

      await publishCommand([], RICH_STYLES, process.cwd());

      expect(console.info).toHaveBeenCalledWith('Nothing to publish.');
      expect(mockPublishPackage).not.toHaveBeenCalled();
    });

    it('skips with a warning and publishes nothing when explicit --tags names an unpublishable tag', async () => {
      mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/basic']));
      mockResolveReleaseTags.mockReturnValue([
        { tag: 'basic-v1.0.0', kind: 'package', dir: 'basic', workspacePath: 'packages/basic', isPublishable: false },
      ]);

      await publishCommand(['--tags=basic-v1.0.0'], RICH_STYLES, process.cwd());

      // When --tags names an unpublishable tag, the command warns and skips it rather than exiting non-zero.
      expect(console.warn).toHaveBeenCalledWith(
        'Skipping basic-v1.0.0 (packages/basic): package.json#private is true.',
      );
      expect(console.info).toHaveBeenCalledWith('Nothing to publish.');
      expect(mockPublishPackage).not.toHaveBeenCalled();
    });

    it('warns for every unpublishable tag when explicit --tags names multiple unpublishable tags', async () => {
      mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/basic', 'packages/internal']));
      mockResolveReleaseTags.mockReturnValue([
        { tag: 'basic-v1.0.0', kind: 'package', dir: 'basic', workspacePath: 'packages/basic', isPublishable: false },
        {
          tag: 'internal-v2.0.0',
          kind: 'package',
          dir: 'internal',
          workspacePath: 'packages/internal',
          isPublishable: false,
        },
      ]);

      await publishCommand(['--tags=basic-v1.0.0,internal-v2.0.0'], RICH_STYLES, process.cwd());

      expect(console.warn).toHaveBeenCalledWith(
        'Skipping basic-v1.0.0 (packages/basic): package.json#private is true.',
      );
      expect(console.warn).toHaveBeenCalledWith(
        'Skipping internal-v2.0.0 (packages/internal): package.json#private is true.',
      );
      expect(console.info).toHaveBeenCalledWith('Nothing to publish.');
      expect(mockPublishPackage).not.toHaveBeenCalled();
    });

    it('publishes the publishable subset and warns about and skips the private tag when explicit --tags mixes both', async () => {
      mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/common-utils', 'packages/basic']));
      mockResolveReleaseTags.mockReturnValue([
        {
          tag: 'common-utils-v2.4.0',
          dir: 'common-utils',
          workspacePath: 'packages/common-utils',
          isPublishable: true,
        },
        { tag: 'basic-v1.0.0', kind: 'package', dir: 'basic', workspacePath: 'packages/basic', isPublishable: false },
      ]);

      await publishCommand(['--tags=common-utils-v2.4.0,basic-v1.0.0'], RICH_STYLES, process.cwd());

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
        expect.objectContaining({ isDryRun: false, shouldGenerateProvenance: false }),
      );
    });
  });

  describe('project tag', () => {
    const PROJECT_TAG = { tag: 'v0.13.0', kind: 'project', dir: '', workspacePath: '.', isPublishable: false };

    beforeEach(() => {
      mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core']));
      mockResolveReleaseTags.mockReturnValue([
        { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
        PROJECT_TAG,
      ]);
      mockLoadConfig.mockResolvedValue({ project: {} });
    });

    it('publishes the workspace tags and silently drops the project tag on an implicit run', async () => {
      await publishCommand([], RICH_STYLES, process.cwd());

      expect(mockPublishPackage).toHaveBeenCalledTimes(1);
      expect(mockPublishPackage).toHaveBeenCalledWith(
        expect.objectContaining({ tag: 'core-v1.3.0' }),
        expect.anything(),
        expect.anything(),
      );
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('warns that a project tag is not an npm package when --tags names it', async () => {
      await publishCommand(['--tags=v0.13.0'], RICH_STYLES, process.cwd());

      expect(console.warn).toHaveBeenCalledExactlyOnceWith('Skipping v0.13.0: a project tag is not an npm package.');
      expect(console.info).toHaveBeenCalledWith('Nothing to publish.');
      expect(mockPublishPackage).not.toHaveBeenCalled();
    });
  });

  describe('clean-tree gate', () => {
    it('exits with error when the working tree is dirty', async () => {
      mockAssertCleanWorkingTree.mockImplementation(() => {
        throw new Error('Working tree has uncommitted changes.');
      });

      const error = await captureError(ProcessExitError, () => publishCommand([], RICH_STYLES, process.cwd()));

      expect(error.code).toBe(1);
      expect(stdioCapture.stderr).toContain('uncommitted changes');
      expect(mockResolveReleaseTags).not.toHaveBeenCalled();
      expect(mockPublishPackage).not.toHaveBeenCalled();
    });

    it('proceeds when the working tree is clean', async () => {
      await publishCommand([], RICH_STYLES, process.cwd());

      expect(mockAssertCleanWorkingTree).toHaveBeenCalledTimes(1);
      expect(mockPublishPackage).toHaveBeenCalledTimes(1);
    });

    it('skips the check when --no-git-checks is provided', async () => {
      await publishCommand(['--no-git-checks'], RICH_STYLES, process.cwd());

      expect(mockAssertCleanWorkingTree).not.toHaveBeenCalled();
      expect(mockPublishPackage).toHaveBeenCalledTimes(1);
    });

    it('skips the check when --dry-run is provided', async () => {
      await publishCommand(['--dry-run'], RICH_STYLES, process.cwd());

      expect(mockAssertCleanWorkingTree).not.toHaveBeenCalled();
      expect(mockPublishPackage).toHaveBeenCalledTimes(1);
    });
  });
});
