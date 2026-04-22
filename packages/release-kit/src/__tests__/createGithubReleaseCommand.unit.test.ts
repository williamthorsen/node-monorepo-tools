import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockDiscoverWorkspaces = vi.hoisted(() => vi.fn());
const mockResolveReleaseTags = vi.hoisted(() => vi.fn());
const mockCreateGithubReleases = vi.hoisted(() => vi.fn());
const mockResolveReleaseNotesConfig = vi.hoisted(() => vi.fn());
const mockDeriveWorkspaceConfig = vi.hoisted(() => vi.fn());

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

vi.mock('../deriveWorkspaceConfig.ts', () => ({
  deriveWorkspaceConfig: mockDeriveWorkspaceConfig,
}));

import { createGithubReleaseCommand } from '../createGithubReleaseCommand.ts';

/** Sentinel error thrown by the mocked process.exit. */
class ExitError extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

describe(createGithubReleaseCommand, () => {
  beforeEach(() => {
    mockDiscoverWorkspaces.mockResolvedValue(undefined);
    mockResolveReleaseTags.mockReturnValue([{ tag: 'v1.0.0', dir: '.', workspacePath: '.' }]);
    mockCreateGithubReleases.mockReturnValue({ created: ['v1.0.0'], skipped: [] });
    mockDeriveWorkspaceConfig.mockImplementation((workspacePath: string) => ({
      dir: workspacePath.split('/').pop(),
      tagPrefix: `${workspacePath.split('/').pop()}-v`,
      workspacePath,
      packageFiles: [`${workspacePath}/package.json`],
      changelogPaths: [workspacePath],
      paths: [`${workspacePath}/**`],
    }));
    mockResolveReleaseNotesConfig.mockResolvedValue({
      releaseNotes: { shouldInjectIntoReadme: false },
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

  it('creates GitHub Releases for all tags on HEAD when --tags is omitted', async () => {
    await createGithubReleaseCommand([]);

    expect(mockCreateGithubReleases).toHaveBeenCalledWith(
      [{ tag: 'v1.0.0', dir: '.', workspacePath: '.' }],
      '.meta/changelog.json',
      false,
      ['Bug fixes', 'Features'],
    );
  });

  it('passes --dry-run to createGithubReleases', async () => {
    await createGithubReleaseCommand(['--dry-run']);

    expect(mockCreateGithubReleases).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      true,
      expect.anything(),
    );
  });

  it('filters tags by --tags using full tag names in monorepo mode', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core', 'packages/release-kit']);
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' },
      { tag: 'release-kit-v2.1.0', dir: 'release-kit', workspacePath: 'packages/release-kit' },
    ]);

    await createGithubReleaseCommand(['--tags=core-v1.3.0']);

    expect(mockCreateGithubReleases).toHaveBeenCalledWith(
      [{ tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' }],
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('filters multiple tags by --tags', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core', 'packages/release-kit', 'packages/extra']);
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' },
      { tag: 'release-kit-v2.1.0', dir: 'release-kit', workspacePath: 'packages/release-kit' },
      { tag: 'extra-v0.1.0', dir: 'extra', workspacePath: 'packages/extra' },
    ]);

    await createGithubReleaseCommand(['--tags=core-v1.3.0,extra-v0.1.0']);

    expect(mockCreateGithubReleases).toHaveBeenCalledWith(
      [
        { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' },
        { tag: 'extra-v0.1.0', dir: 'extra', workspacePath: 'packages/extra' },
      ],
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('exits with code 1 on unknown flags', async () => {
    let thrown: ExitError | undefined;
    try {
      await createGithubReleaseCommand(['--unknown']);
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
      await createGithubReleaseCommand([]);
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

  it('exits with code 1 when --tags references an unmatched tag', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core']);
    mockResolveReleaseTags.mockReturnValue([{ tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' }]);

    let thrown: ExitError | undefined;
    try {
      await createGithubReleaseCommand(['--tags=core-v9.9.9']);
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(thrown?.code).toBe(1);
    expect(console.error).toHaveBeenCalledWith('Error: Unknown tag "core-v9.9.9" in --tags. Available: core-v1.3.0');
  });

  it('exits with code 1 when discoverWorkspaces throws', async () => {
    mockDiscoverWorkspaces.mockRejectedValue(new Error('discovery failed'));

    let thrown: ExitError | undefined;
    try {
      await createGithubReleaseCommand([]);
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(thrown?.code).toBe(1);
    expect(console.error).toHaveBeenCalledWith('Error discovering workspaces: discovery failed');
  });

  it('exits with code 1 when --tags is explicit and all requested tags produce no Release', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core', 'packages/extra']);
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' },
      { tag: 'extra-v0.1.0', dir: 'extra', workspacePath: 'packages/extra' },
    ]);
    mockCreateGithubReleases.mockReturnValue({ created: [], skipped: ['core-v1.3.0', 'extra-v0.1.0'] });

    let thrown: ExitError | undefined;
    try {
      await createGithubReleaseCommand(['--tags=core-v1.3.0,extra-v0.1.0']);
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(thrown?.code).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      'Error: no GitHub Releases were created for requested tags: core-v1.3.0, extra-v0.1.0. ' +
        'Each was skipped (missing changelog entry, no all-audience content, or empty rendered body).',
    );
  });

  it('does not exit when --tags is omitted and every tag is skipped', async () => {
    // When the user did not single out tags, an all-skipped outcome is informational, not a failure.
    mockCreateGithubReleases.mockReturnValue({ created: [], skipped: ['v1.0.0'] });

    await createGithubReleaseCommand([]);

    expect(console.info).toHaveBeenCalledWith('Skipped 1 tag(s) with no releasable content: v1.0.0.');
  });

  it('logs an info summary when some tags are skipped but others succeed', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core', 'packages/extra']);
    mockResolveReleaseTags.mockReturnValue([
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' },
      { tag: 'extra-v0.1.0', dir: 'extra', workspacePath: 'packages/extra' },
    ]);
    mockCreateGithubReleases.mockReturnValue({ created: ['core-v1.3.0'], skipped: ['extra-v0.1.0'] });

    await createGithubReleaseCommand(['--tags=core-v1.3.0,extra-v0.1.0']);

    expect(console.info).toHaveBeenCalledWith('Skipped 1 tag(s) with no releasable content: extra-v0.1.0.');
  });

  it('exits with code 1 when createGithubReleases throws', async () => {
    mockCreateGithubReleases.mockImplementation(() => {
      throw new Error('gh release failed');
    });

    let thrown: ExitError | undefined;
    try {
      await createGithubReleaseCommand([]);
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(thrown?.code).toBe(1);
    expect(console.error).toHaveBeenCalledWith('Error creating GitHub Releases: gh release failed');
  });

  it('exits with code 1 when resolveReleaseNotesConfig fails to load config', async () => {
    mockResolveReleaseNotesConfig.mockImplementation(() => {
      // Mirror the strictLoad path: the production code calls process.exit(1) inside the resolver,
      // which the spy converts into ExitError. Throwing it here matches that observable behavior.
      console.error('Error: failed to load config: read failure');
      throw new ExitError(1);
    });

    let thrown: ExitError | undefined;
    try {
      await createGithubReleaseCommand([]);
    } catch (error: unknown) {
      if (error instanceof ExitError) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect(thrown?.code).toBe(1);
    expect(mockResolveReleaseNotesConfig).toHaveBeenCalledWith({ strictLoad: true });
    expect(mockCreateGithubReleases).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('Error: failed to load config: read failure');
  });

  describe('--tags parsing', () => {
    it('rejects --tags= (empty value) with a clear "requires a value" error', async () => {
      // The shared parseArgs helper rejects empty `--flag=` values before the command sees them,
      // so the user gets a precise error rather than a confusing "Unknown tag" downstream.
      let thrown: ExitError | undefined;
      try {
        await createGithubReleaseCommand(['--tags=']);
      } catch (error: unknown) {
        if (error instanceof ExitError) {
          thrown = error;
        }
      }

      expect(thrown).toBeInstanceOf(ExitError);
      expect(thrown?.code).toBe(1);
      expect(console.error).toHaveBeenCalledWith('Error: --tags requires a value');
      expect(mockCreateGithubReleases).not.toHaveBeenCalled();
    });

    it('drops empty segments from --tags=foo, (trailing comma)', async () => {
      mockDiscoverWorkspaces.mockResolvedValue(['packages/core']);
      mockResolveReleaseTags.mockReturnValue([{ tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' }]);

      await createGithubReleaseCommand(['--tags=core-v1.3.0,']);

      expect(mockCreateGithubReleases).toHaveBeenCalledWith(
        [{ tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' }],
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it('treats --tags=, (only commas) as no filter, preserving all HEAD tags', async () => {
      await createGithubReleaseCommand(['--tags=,,']);

      expect(mockCreateGithubReleases).toHaveBeenCalledWith(
        [{ tag: 'v1.0.0', dir: '.', workspacePath: '.' }],
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });
  });
});
