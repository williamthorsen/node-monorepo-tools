import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockDiscoverWorkspaces = vi.hoisted(() => vi.fn());
const mockResolveReleaseTags = vi.hoisted(() => vi.fn());
const mockDetectPackageManager = vi.hoisted(() => vi.fn());
const mockPublish = vi.hoisted(() => vi.fn());
const mockLoadConfig = vi.hoisted(() => vi.fn());
const mockValidateConfig = vi.hoisted(() => vi.fn());
const mockCreateGithubReleases = vi.hoisted(() => vi.fn());

vi.mock('../discoverWorkspaces.ts', () => ({
  discoverWorkspaces: mockDiscoverWorkspaces,
}));

vi.mock('../resolveReleaseTags.ts', () => ({
  resolveReleaseTags: mockResolveReleaseTags,
}));

vi.mock('../detectPackageManager.ts', () => ({
  detectPackageManager: mockDetectPackageManager,
}));

vi.mock('../publish.ts', () => ({
  publish: mockPublish,
}));

vi.mock('../loadConfig.ts', () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock('../validateConfig.ts', () => ({
  validateConfig: mockValidateConfig,
}));

vi.mock('../createGithubRelease.ts', () => ({
  createGithubReleases: mockCreateGithubReleases,
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
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitError(typeof code === 'number' ? code : undefined);
    });
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    mockDiscoverWorkspaces.mockReset();
    mockResolveReleaseTags.mockReset();
    mockDetectPackageManager.mockReset();
    mockPublish.mockReset();
    mockLoadConfig.mockReset();
    mockValidateConfig.mockReset();
    mockCreateGithubReleases.mockReset();
    vi.restoreAllMocks();
  });

  it('delegates to publish with default options', async () => {
    await publishCommand([]);

    expect(mockPublish).toHaveBeenCalledWith(
      [{ tag: 'v1.0.0', dir: '.', workspacePath: '.' }],
      'npm',
      expect.objectContaining({ dryRun: false, noGitChecks: false, provenance: false }),
    );
  });

  it('passes dryRun when --dry-run is provided', async () => {
    await publishCommand(['--dry-run']);

    expect(mockPublish).toHaveBeenCalledWith(
      expect.anything(),
      'npm',
      expect.objectContaining({ dryRun: true, noGitChecks: false, provenance: false }),
    );
  });

  it('passes noGitChecks when --no-git-checks is provided', async () => {
    await publishCommand(['--no-git-checks']);

    expect(mockPublish).toHaveBeenCalledWith(
      expect.anything(),
      'npm',
      expect.objectContaining({ dryRun: false, noGitChecks: true, provenance: false }),
    );
  });

  it('passes provenance when --provenance is provided', async () => {
    await publishCommand(['--provenance']);

    expect(mockPublish).toHaveBeenCalledWith(
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
    expect(mockPublish).not.toHaveBeenCalled();
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

  it('exits with code 1 when --only is used in single-package mode', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(undefined);

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
    expect(console.error).toHaveBeenCalledWith('Error: --only is only supported for monorepo configurations');
  });

  it('filters resolved tags by --only in monorepo mode', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core', 'packages/release-kit']);
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' },
      { tag: 'release-kit-v2.1.0', dir: 'release-kit', workspacePath: 'packages/release-kit' },
    ]);

    await publishCommand(['--only=core']);

    expect(mockPublish).toHaveBeenCalledWith(
      [{ tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' }],
      'npm',
      expect.objectContaining({ dryRun: false, noGitChecks: false, provenance: false }),
    );
  });

  it('exits with code 1 when --only references an unmatched name', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core']);
    mockResolveReleaseTags.mockReturnValue([{ tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' }]);

    let thrown: ExitError | undefined;
    try {
      await publishCommand(['--only=nonexistent']);
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(thrown?.code).toBe(1);
    expect(console.error).toHaveBeenCalledWith('Error: Unknown package "nonexistent" in --only. Available: core');
  });

  it('exits with code 1 when publish throws', async () => {
    mockPublish.mockImplementation(() => {
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

  it('uses the detected package manager', async () => {
    mockDetectPackageManager.mockReturnValue('pnpm');

    await publishCommand([]);

    expect(mockPublish).toHaveBeenCalledWith(expect.anything(), 'pnpm', expect.anything());
  });

  describe('config loading', () => {
    it('passes releaseNotes and changelogJsonOutputPath from loaded config', async () => {
      mockLoadConfig.mockResolvedValue({ releaseNotes: {}, changelogJson: {} });
      mockValidateConfig.mockReturnValue({
        config: {
          releaseNotes: { shouldCreateGithubRelease: true, shouldInjectIntoReadme: true },
          changelogJson: { outputPath: 'custom/changelog.json' },
        },
        errors: [],
        warnings: [],
      });

      await publishCommand([]);

      expect(mockPublish).toHaveBeenCalledWith(
        expect.anything(),
        'npm',
        expect.objectContaining({
          releaseNotes: expect.objectContaining({
            shouldCreateGithubRelease: true,
            shouldInjectIntoReadme: true,
          }),
          changelogJsonOutputPath: 'custom/changelog.json',
        }),
      );
      expect(mockCreateGithubReleases).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ shouldCreateGithubRelease: true }),
        'custom/changelog.json',
        false,
      );
    });

    it('uses defaults when loadConfig throws', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockLoadConfig.mockRejectedValue(new Error('config read failure'));

      await publishCommand([]);

      expect(mockPublish).toHaveBeenCalledWith(
        expect.anything(),
        'npm',
        expect.objectContaining({
          releaseNotes: expect.objectContaining({
            shouldCreateGithubRelease: false,
            shouldInjectIntoReadme: false,
          }),
        }),
      );
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed to load config'));
    });

    it('prints validation warnings from config', async () => {
      mockLoadConfig.mockResolvedValue({ releaseNotes: {} });
      mockValidateConfig.mockReturnValue({
        config: { releaseNotes: { shouldCreateGithubRelease: true } },
        errors: [],
        warnings: ['releaseNotes.shouldCreateGithubRelease is enabled but changelogJson.enabled is false'],
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await publishCommand([]);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('shouldCreateGithubRelease'));
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
      expect(mockPublish).not.toHaveBeenCalled();
    });
  });
});
