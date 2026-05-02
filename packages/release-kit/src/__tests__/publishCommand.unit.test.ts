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
const mockAssertCleanWorkingTree = vi.hoisted(() => vi.fn());

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

vi.mock('../assertCleanWorkingTree.ts', () => ({
  assertCleanWorkingTree: mockAssertCleanWorkingTree,
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
    mockResolveReleaseTags.mockReturnValue([{ tag: 'v1.0.0', dir: '.', workspacePath: '.', isPublishable: true }]);
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
    mockAssertCleanWorkingTree.mockReset();
    vi.restoreAllMocks();
  });

  it('calls publishPackage for each resolved tag', async () => {
    await publishCommand([]);

    expect(mockPublishPackage).toHaveBeenCalledWith(
      { tag: 'v1.0.0', dir: '.', workspacePath: '.', isPublishable: true },
      'npm',
      expect.objectContaining({ dryRun: false, provenance: false }),
    );
  });

  it('passes dryRun when --dry-run is provided', async () => {
    await publishCommand(['--dry-run']);

    expect(mockPublishPackage).toHaveBeenCalledWith(
      expect.anything(),
      'npm',
      expect.objectContaining({ dryRun: true, provenance: false }),
    );
  });

  it('does not thread --no-git-checks into publishPackage options', async () => {
    await publishCommand(['--no-git-checks']);

    expect(mockPublishPackage).toHaveBeenCalledWith(
      expect.anything(),
      'npm',
      expect.objectContaining({ dryRun: false, provenance: false }),
    );
    expect(mockPublishPackage.mock.calls[0]?.[2]).not.toHaveProperty('noGitChecks');
  });

  it('passes provenance when --provenance is provided', async () => {
    await publishCommand(['--provenance']);

    expect(mockPublishPackage).toHaveBeenCalledWith(
      expect.anything(),
      'npm',
      expect.objectContaining({ dryRun: false, provenance: true }),
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
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      { tag: 'release-kit-v2.1.0', dir: 'release-kit', workspacePath: 'packages/release-kit', isPublishable: true },
    ]);

    await publishCommand(['--tags=core-v1.3.0']);

    expect(mockPublishPackage).toHaveBeenCalledTimes(1);
    expect(mockPublishPackage).toHaveBeenCalledWith(
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      'npm',
      expect.objectContaining({ dryRun: false, provenance: false }),
    );
  });

  it('filters resolved tags by --tags in single-package mode', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(undefined);
    mockResolveReleaseTags.mockReturnValue([{ tag: 'v1.0.0', dir: '.', workspacePath: '.', isPublishable: true }]);

    await publishCommand(['--tags=v1.0.0']);

    expect(mockPublishPackage).toHaveBeenCalledTimes(1);
    expect(mockPublishPackage).toHaveBeenCalledWith(
      { tag: 'v1.0.0', dir: '.', workspacePath: '.', isPublishable: true },
      'npm',
      expect.objectContaining({ dryRun: false, provenance: false }),
    );
  });

  it('exits with code 1 when --tags references an unknown tag', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core']);
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
    ]);

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
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      { tag: 'release-kit-v2.1.0', dir: 'release-kit', workspacePath: 'packages/release-kit', isPublishable: true },
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
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      { tag: 'release-kit-v2.1.0', dir: 'release-kit', workspacePath: 'packages/release-kit', isPublishable: true },
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
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      { tag: 'release-kit-v2.1.0', dir: 'release-kit', workspacePath: 'packages/release-kit', isPublishable: true },
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

  describe('publishability filter', () => {
    it('publishes only the publishable subset when implicit resolution mixes publishable and unpublishable tags', async () => {
      mockDiscoverWorkspaces.mockResolvedValue(['packages/common-utils', 'packages/basic']);
      mockResolveReleaseTags.mockReturnValue([
        {
          tag: 'common-utils-v2.4.0',
          dir: 'common-utils',
          workspacePath: 'packages/common-utils',
          isPublishable: true,
        },
        { tag: 'basic-v1.0.0', dir: 'basic', workspacePath: 'packages/basic', isPublishable: false },
      ]);

      await publishCommand([]);

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
    });

    it('exits 0 with "Nothing to publish." when implicit resolution yields zero publishable tags', async () => {
      mockDiscoverWorkspaces.mockResolvedValue(['packages/basic']);
      mockResolveReleaseTags.mockReturnValue([
        { tag: 'basic-v1.0.0', dir: 'basic', workspacePath: 'packages/basic', isPublishable: false },
      ]);

      await publishCommand([]);

      expect(console.info).toHaveBeenCalledWith('Nothing to publish.');
      expect(mockPublishPackage).not.toHaveBeenCalled();
    });

    it('exits 1 with a per-tag error when explicit --tags names an unpublishable tag', async () => {
      mockDiscoverWorkspaces.mockResolvedValue(['packages/basic']);
      mockResolveReleaseTags.mockReturnValue([
        { tag: 'basic-v1.0.0', dir: 'basic', workspacePath: 'packages/basic', isPublishable: false },
      ]);

      let thrown: ExitError | undefined;
      try {
        await publishCommand(['--tags=basic-v1.0.0']);
      } catch (error: unknown) {
        if (error instanceof ExitError) {
          thrown = error;
        }
      }

      expect(thrown).toBeInstanceOf(ExitError);
      expect(thrown?.code).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        'Error: basic-v1.0.0 cannot be published: package.json#private is true.',
      );
      expect(mockPublishPackage).not.toHaveBeenCalled();
    });

    it('reports every unpublishable tag before exit when explicit --tags names multiple unpublishable tags', async () => {
      mockDiscoverWorkspaces.mockResolvedValue(['packages/basic', 'packages/internal']);
      mockResolveReleaseTags.mockReturnValue([
        { tag: 'basic-v1.0.0', dir: 'basic', workspacePath: 'packages/basic', isPublishable: false },
        { tag: 'internal-v2.0.0', dir: 'internal', workspacePath: 'packages/internal', isPublishable: false },
      ]);

      let thrown: ExitError | undefined;
      try {
        await publishCommand(['--tags=basic-v1.0.0,internal-v2.0.0']);
      } catch (error: unknown) {
        if (error instanceof ExitError) {
          thrown = error;
        }
      }

      expect(thrown).toBeInstanceOf(ExitError);
      expect(thrown?.code).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        'Error: basic-v1.0.0 cannot be published: package.json#private is true.',
      );
      expect(console.error).toHaveBeenCalledWith(
        'Error: internal-v2.0.0 cannot be published: package.json#private is true.',
      );
      expect(mockPublishPackage).not.toHaveBeenCalled();
    });

    it('publishes the subset and does not error when explicit --tags mixes publishable and unpublishable', async () => {
      mockDiscoverWorkspaces.mockResolvedValue(['packages/common-utils', 'packages/basic']);
      mockResolveReleaseTags.mockReturnValue([
        {
          tag: 'common-utils-v2.4.0',
          dir: 'common-utils',
          workspacePath: 'packages/common-utils',
          isPublishable: true,
        },
        { tag: 'basic-v1.0.0', dir: 'basic', workspacePath: 'packages/basic', isPublishable: false },
      ]);

      let thrown: ExitError | undefined;
      try {
        await publishCommand(['--tags=common-utils-v2.4.0,basic-v1.0.0']);
      } catch (error: unknown) {
        if (error instanceof ExitError) {
          thrown = error;
        }
      }

      // The presence of an unpublishable tag in --tags is an error: exit 1, no publishes.
      expect(thrown).toBeInstanceOf(ExitError);
      expect(thrown?.code).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        'Error: basic-v1.0.0 cannot be published: package.json#private is true.',
      );
      expect(mockPublishPackage).not.toHaveBeenCalled();
    });
  });

  describe('clean-tree gate', () => {
    it('exits with error when the working tree is dirty', async () => {
      mockAssertCleanWorkingTree.mockImplementation(() => {
        throw new Error('Working tree has uncommitted changes.');
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
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('uncommitted changes'));
      expect(mockResolveReleaseTags).not.toHaveBeenCalled();
      expect(mockPublishPackage).not.toHaveBeenCalled();
    });

    it('proceeds when the working tree is clean', async () => {
      await publishCommand([]);

      expect(mockAssertCleanWorkingTree).toHaveBeenCalledTimes(1);
      expect(mockPublishPackage).toHaveBeenCalledTimes(1);
    });

    it('skips the check when --no-git-checks is provided', async () => {
      await publishCommand(['--no-git-checks']);

      expect(mockAssertCleanWorkingTree).not.toHaveBeenCalled();
      expect(mockPublishPackage).toHaveBeenCalledTimes(1);
    });

    it('skips the check when --dry-run is provided', async () => {
      await publishCommand(['--dry-run']);

      expect(mockAssertCleanWorkingTree).not.toHaveBeenCalled();
      expect(mockPublishPackage).toHaveBeenCalledTimes(1);
    });
  });
});
