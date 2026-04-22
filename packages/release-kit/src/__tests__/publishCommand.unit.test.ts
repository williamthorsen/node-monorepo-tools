import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockDiscoverWorkspaces = vi.hoisted(() => vi.fn());
const mockResolveReleaseTags = vi.hoisted(() => vi.fn());
const mockDetectPackageManager = vi.hoisted(() => vi.fn());
const mockPublishPackage = vi.hoisted(() => vi.fn());
const mockLoadConfig = vi.hoisted(() => vi.fn());
const mockValidateConfig = vi.hoisted(() => vi.fn());
const mockCreateGithubReleases = vi.hoisted(() => vi.fn());
const mockInjectReleaseNotesIntoReadme = vi.hoisted(() => vi.fn());
const mockResolveReadmePath = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockDeriveWorkspaceConfig = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  writeFileSync: mockWriteFileSync,
}));

vi.mock('../discoverWorkspaces.ts', () => ({
  discoverWorkspaces: mockDiscoverWorkspaces,
}));

vi.mock('../resolveReleaseTags.ts', () => ({
  resolveReleaseTags: mockResolveReleaseTags,
}));

vi.mock('../deriveWorkspaceConfig.ts', () => ({
  deriveWorkspaceConfig: mockDeriveWorkspaceConfig,
}));

vi.mock('../detectPackageManager.ts', () => ({
  detectPackageManager: mockDetectPackageManager,
}));

vi.mock('../publish.ts', () => ({
  publishPackage: mockPublishPackage,
}));

vi.mock('../loadConfig.ts', async () => {
  const actual = await vi.importActual<typeof import('../loadConfig.ts')>('../loadConfig.ts');
  return {
    ...actual,
    loadConfig: mockLoadConfig,
  };
});

vi.mock('../validateConfig.ts', () => ({
  validateConfig: mockValidateConfig,
}));

vi.mock('../createGithubRelease.ts', () => ({
  createGithubReleases: mockCreateGithubReleases,
}));

vi.mock('../injectReleaseNotesIntoReadme.ts', () => ({
  injectReleaseNotesIntoReadme: mockInjectReleaseNotesIntoReadme,
  resolveReadmePath: mockResolveReadmePath,
}));

import { publishCommand } from '../publishCommand.ts';

/** Sentinel error thrown by the mocked process.exit. */
class ExitError extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

describe(publishCommand, () => {
  beforeEach(() => {
    mockDiscoverWorkspaces.mockResolvedValue(undefined);
    mockResolveReleaseTags.mockReturnValue([{ tag: 'v1.0.0', dir: '.', workspacePath: '.' }]);
    mockDetectPackageManager.mockReturnValue('npm');
    mockLoadConfig.mockResolvedValue(undefined);
    mockValidateConfig.mockReturnValue({ config: {}, errors: [], warnings: [] });
    mockResolveReadmePath.mockReturnValue(undefined);
    mockDeriveWorkspaceConfig.mockImplementation((workspacePath: string) => {
      const dir = workspacePath.split('/').pop() ?? workspacePath;
      return {
        dir,
        tagPrefix: `${dir}-v`,
        workspacePath,
        packageFiles: [`${workspacePath}/package.json`],
        changelogPaths: [workspacePath],
        paths: [`${workspacePath}/**`],
      };
    });
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitError(typeof code === 'number' ? code : undefined);
    });
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    mockDiscoverWorkspaces.mockReset();
    mockResolveReleaseTags.mockReset();
    mockDetectPackageManager.mockReset();
    mockPublishPackage.mockReset();
    mockLoadConfig.mockReset();
    mockValidateConfig.mockReset();
    mockCreateGithubReleases.mockReset();
    mockInjectReleaseNotesIntoReadme.mockReset();
    mockResolveReadmePath.mockReset();
    mockWriteFileSync.mockReset();
    mockDeriveWorkspaceConfig.mockReset();
    vi.restoreAllMocks();
  });

  it('calls publishPackage for each resolved tag', async () => {
    await publishCommand([]);

    expect(mockPublishPackage).toHaveBeenCalledWith(
      { tag: 'v1.0.0', dir: '.', workspacePath: '.' },
      'npm',
      expect.objectContaining({ dryRun: false, noGitChecks: false, provenance: false }),
    );
  });

  it('passes dryRun when --dry-run is provided', async () => {
    await publishCommand(['--dry-run']);

    expect(mockPublishPackage).toHaveBeenCalledWith(
      expect.anything(),
      'npm',
      expect.objectContaining({ dryRun: true, noGitChecks: false, provenance: false }),
    );
  });

  it('passes noGitChecks when --no-git-checks is provided', async () => {
    await publishCommand(['--no-git-checks']);

    expect(mockPublishPackage).toHaveBeenCalledWith(
      expect.anything(),
      'npm',
      expect.objectContaining({ dryRun: false, noGitChecks: true, provenance: false }),
    );
  });

  it('passes provenance when --provenance is provided', async () => {
    await publishCommand(['--provenance']);

    expect(mockPublishPackage).toHaveBeenCalledWith(
      expect.anything(),
      'npm',
      expect.objectContaining({ dryRun: false, noGitChecks: false, provenance: true }),
    );
  });

  it('exits with code 1 on unknown flags', async () => {
    let thrown: ExitError | undefined;
    try {
      await publishCommand(['--unknown']);
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(thrown?.code).toBe(1);
    expect(console.error).toHaveBeenCalledWith('Error: Unknown option: --unknown');
    expect(mockPublishPackage).not.toHaveBeenCalled();
  });

  it('exits with code 1 when no release tags are found on HEAD', async () => {
    mockResolveReleaseTags.mockReturnValue([]);

    let thrown: ExitError | undefined;
    try {
      await publishCommand([]);
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(thrown?.code).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      'Error: No release tags found on HEAD. Create tags with `release-kit tag` first.',
    );
  });

  it('filters resolved tags by --tags in monorepo mode', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core', 'packages/release-kit']);
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' },
      { tag: 'release-kit-v2.1.0', dir: 'release-kit', workspacePath: 'packages/release-kit' },
    ]);

    await publishCommand(['--tags=core-v1.3.0']);

    expect(mockPublishPackage).toHaveBeenCalledTimes(1);
    expect(mockPublishPackage).toHaveBeenCalledWith(
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' },
      'npm',
      expect.objectContaining({ dryRun: false, noGitChecks: false, provenance: false }),
    );
  });

  it('filters resolved tags by --tags in single-package mode', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(undefined);
    mockResolveReleaseTags.mockReturnValue([{ tag: 'v1.0.0', dir: '.', workspacePath: '.' }]);

    await publishCommand(['--tags=v1.0.0']);

    expect(mockPublishPackage).toHaveBeenCalledTimes(1);
    expect(mockPublishPackage).toHaveBeenCalledWith(
      { tag: 'v1.0.0', dir: '.', workspacePath: '.' },
      'npm',
      expect.objectContaining({ dryRun: false, noGitChecks: false, provenance: false }),
    );
  });

  it('exits with code 1 when --tags references an unknown tag', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core']);
    mockResolveReleaseTags.mockReturnValue([{ tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' }]);

    let thrown: ExitError | undefined;
    try {
      await publishCommand(['--tags=missing-v9.9.9']);
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(thrown?.code).toBe(1);
    expect(console.error).toHaveBeenCalledWith('Error: Unknown tag "missing-v9.9.9" in --tags. Available: core-v1.3.0');
  });

  it('exits with code 1 when --only is passed (flag removed)', async () => {
    let thrown: ExitError | undefined;
    try {
      await publishCommand(['--only=core']);
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(thrown?.code).toBe(1);
    expect(console.error).toHaveBeenCalledWith('Error: Unknown option: --only');
  });

  it('exits with code 1 when publishPackage throws', async () => {
    mockPublishPackage.mockImplementation(() => {
      throw new Error('publish failed');
    });

    let thrown: ExitError | undefined;
    try {
      await publishCommand([]);
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(thrown?.code).toBe(1);
    expect(console.error).toHaveBeenCalledWith('publish failed');
  });

  it('does not invoke any GitHub Release path during publish', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core', 'packages/release-kit']);
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' },
      { tag: 'release-kit-v2.1.0', dir: 'release-kit', workspacePath: 'packages/release-kit' },
    ]);

    await publishCommand([]);

    expect(mockCreateGithubReleases).not.toHaveBeenCalled();
  });

  it('uses the detected package manager', async () => {
    mockDetectPackageManager.mockReturnValue('pnpm');

    await publishCommand([]);

    expect(mockPublishPackage).toHaveBeenCalledWith(expect.anything(), 'pnpm', expect.anything());
  });

  it('prints confirmation listing before publishing', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core', 'packages/release-kit']);
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' },
      { tag: 'release-kit-v2.1.0', dir: 'release-kit', workspacePath: 'packages/release-kit' },
    ]);

    await publishCommand([]);

    expect(console.info).toHaveBeenCalledWith('Publishing:');
    expect(console.info).toHaveBeenCalledWith('  core-v1.3.0 (packages/core)');
    expect(console.info).toHaveBeenCalledWith('  release-kit-v2.1.0 (packages/release-kit)');
  });

  it('prints dry-run confirmation listing', async () => {
    await publishCommand(['--dry-run']);

    expect(console.info).toHaveBeenCalledWith('[dry-run] Would publish:');
  });

  it('reports successfully published packages when a subsequent publish fails', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core', 'packages/release-kit']);
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' },
      { tag: 'release-kit-v2.1.0', dir: 'release-kit', workspacePath: 'packages/release-kit' },
    ]);
    mockPublishPackage.mockImplementation((resolvedTag: { tag: string }) => {
      if (resolvedTag.tag === 'release-kit-v2.1.0') {
        throw new Error('publish failed');
      }
    });

    let thrown: ExitError | undefined;
    try {
      await publishCommand([]);
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(console.warn).toHaveBeenCalledWith('Packages published before failure:');
    expect(console.warn).toHaveBeenCalledWith('  core-v1.3.0');
  });

  describe('config loading', () => {
    it('uses defaults when loadConfig throws', async () => {
      mockLoadConfig.mockRejectedValue(new Error('config read failure'));

      await publishCommand([]);

      expect(mockPublishPackage).toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('failed to load config'));
    });

    it('prints validation warnings from config', async () => {
      mockLoadConfig.mockResolvedValue({ releaseNotes: {} });
      mockValidateConfig.mockReturnValue({
        config: { releaseNotes: { shouldInjectIntoReadme: true } },
        errors: [],
        warnings: ['releaseNotes.shouldInjectIntoReadme is enabled but changelogJson.enabled is false'],
      });

      await publishCommand([]);

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('shouldInjectIntoReadme'));
    });

    it('exits with code 1 when config has validation errors', async () => {
      mockLoadConfig.mockResolvedValue({ bogus: 123 });
      mockValidateConfig.mockReturnValue({
        config: {},
        errors: ["Unknown field: 'bogus'"],
        warnings: [],
      });

      let thrown: ExitError | undefined;
      try {
        await publishCommand([]);
      } catch (error: unknown) {
        if (error instanceof ExitError) {
          thrown = error;
        }
      }

      expect(thrown).toBeInstanceOf(ExitError);
      expect(thrown?.code).toBe(1);
      expect(console.error).toHaveBeenCalledWith('Invalid config:');
      expect(console.error).toHaveBeenCalledWith("  ❌ Unknown field: 'bogus'");
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

      await publishCommand([]);

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

      let thrown: ExitError | undefined;
      try {
        await publishCommand([]);
      } catch (error: unknown) {
        if (error instanceof ExitError) {
          thrown = error;
        }
      }

      expect(thrown).toBeInstanceOf(ExitError);
      expect(mockWriteFileSync).toHaveBeenCalledWith('/pkg/README.md', '# Original README\n', 'utf8');
    });

    it('skips injection when resolveReadmePath returns undefined', async () => {
      mockResolveReadmePath.mockReturnValue(undefined);

      await publishCommand([]);

      expect(mockInjectReleaseNotesIntoReadme).not.toHaveBeenCalled();
      expect(mockPublishPackage).toHaveBeenCalledTimes(1);
    });

    it('skips restore when injectReleaseNotesIntoReadme returns undefined', async () => {
      mockResolveReadmePath.mockReturnValue('/pkg/README.md');
      mockInjectReleaseNotesIntoReadme.mockReturnValue(undefined);

      await publishCommand([]);

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

      await publishCommand([]);

      expect(mockResolveReadmePath).not.toHaveBeenCalled();
      expect(mockInjectReleaseNotesIntoReadme).not.toHaveBeenCalled();
    });
  });
});
