import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockDiscoverWorkspaces = vi.hoisted(() => vi.fn());
const mockResolveReleaseTags = vi.hoisted(() => vi.fn());
const mockCreateGithubReleases = vi.hoisted(() => vi.fn());
const mockResolveReleaseNotesConfig = vi.hoisted(() => vi.fn());

vi.mock('../discoverWorkspaces.ts', () => ({
  discoverWorkspaces: mockDiscoverWorkspaces,
}));

vi.mock('../resolveReleaseTags.ts', () => ({
  resolveReleaseTags: mockResolveReleaseTags,
}));

vi.mock('../createGithubRelease.ts', () => ({
  createGithubReleases: mockCreateGithubReleases,
}));

vi.mock('../resolveReleaseNotesConfig.ts', () => ({
  resolveReleaseNotesConfig: mockResolveReleaseNotesConfig,
}));

import { githubReleaseCommand } from '../githubReleaseCommand.ts';

/** Sentinel error thrown by the mocked process.exit. */
class ExitError extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

describe(githubReleaseCommand, () => {
  beforeEach(() => {
    mockDiscoverWorkspaces.mockResolvedValue(undefined);
    mockResolveReleaseTags.mockReturnValue([{ tag: 'v1.0.0', dir: '.', workspacePath: '.' }]);
    mockResolveReleaseNotesConfig.mockResolvedValue({
      releaseNotes: { shouldInjectIntoReadme: false, shouldCreateGithubRelease: false },
      changelogJsonOutputPath: '.meta/changelog.json',
      sectionOrder: ['Bug fixes', 'Features'],
    });
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitError(typeof code === 'number' ? code : undefined);
    });
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    mockDiscoverWorkspaces.mockReset();
    mockResolveReleaseTags.mockReset();
    mockCreateGithubReleases.mockReset();
    mockResolveReleaseNotesConfig.mockReset();
    vi.restoreAllMocks();
  });

  it('creates GitHub Releases for tags on HEAD', async () => {
    await githubReleaseCommand([]);

    expect(mockCreateGithubReleases).toHaveBeenCalledWith(
      [{ tag: 'v1.0.0', dir: '.', workspacePath: '.' }],
      expect.objectContaining({ shouldCreateGithubRelease: true }),
      '.meta/changelog.json',
      false,
      ['Bug fixes', 'Features'],
    );
  });

  it('forces shouldCreateGithubRelease to true regardless of config', async () => {
    mockResolveReleaseNotesConfig.mockResolvedValue({
      releaseNotes: { shouldInjectIntoReadme: false, shouldCreateGithubRelease: false },
      changelogJsonOutputPath: '.meta/changelog.json',
      sectionOrder: ['Bug fixes', 'Features'],
    });

    await githubReleaseCommand([]);

    expect(mockCreateGithubReleases).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ shouldCreateGithubRelease: true }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('passes --dry-run to createGithubReleases', async () => {
    await githubReleaseCommand(['--dry-run']);

    expect(mockCreateGithubReleases).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      true,
      expect.anything(),
    );
  });

  it('filters tags by --only in monorepo mode', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core', 'packages/release-kit']);
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' },
      { tag: 'release-kit-v2.1.0', dir: 'release-kit', workspacePath: 'packages/release-kit' },
    ]);

    await githubReleaseCommand(['--only=core']);

    expect(mockCreateGithubReleases).toHaveBeenCalledWith(
      [{ tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' }],
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('exits with code 1 on unknown flags', async () => {
    let thrown: ExitError | undefined;
    try {
      await githubReleaseCommand(['--unknown']);
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(thrown?.code).toBe(1);
    expect(console.error).toHaveBeenCalledWith('Error: Unknown option: --unknown');
  });

  it('exits with code 1 when no release tags are found on HEAD', async () => {
    mockResolveReleaseTags.mockReturnValue([]);

    let thrown: ExitError | undefined;
    try {
      await githubReleaseCommand([]);
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
      await githubReleaseCommand(['--only=core']);
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(thrown?.code).toBe(1);
    expect(console.error).toHaveBeenCalledWith('Error: --only is only supported for monorepo configurations');
  });

  it('exits with code 1 when discoverWorkspaces throws', async () => {
    mockDiscoverWorkspaces.mockRejectedValue(new Error('discovery failed'));

    let thrown: ExitError | undefined;
    try {
      await githubReleaseCommand([]);
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(thrown?.code).toBe(1);
    expect(console.error).toHaveBeenCalledWith('Error discovering workspaces: discovery failed');
  });

  it('exits with code 1 when createGithubReleases throws', async () => {
    mockCreateGithubReleases.mockImplementation(() => {
      throw new Error('gh release failed');
    });

    let thrown: ExitError | undefined;
    try {
      await githubReleaseCommand([]);
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(thrown?.code).toBe(1);
    expect(console.error).toHaveBeenCalledWith('Error creating GitHub Releases: gh release failed');
  });

  it('exits with code 1 when --only references an unmatched name', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core']);
    mockResolveReleaseTags.mockReturnValue([{ tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' }]);

    let thrown: ExitError | undefined;
    try {
      await githubReleaseCommand(['--only=nonexistent']);
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(thrown?.code).toBe(1);
    expect(console.error).toHaveBeenCalledWith('Error: Unknown package "nonexistent" in --only. Available: core');
  });
});
