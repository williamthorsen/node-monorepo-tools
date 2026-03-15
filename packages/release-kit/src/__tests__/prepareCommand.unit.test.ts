import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockDiscoverWorkspaces = vi.hoisted(() => vi.fn());
const mockLoadConfig = vi.hoisted(() => vi.fn());
const mockReleasePrepareMono = vi.hoisted(() => vi.fn());
const mockReleasePrepare = vi.hoisted(() => vi.fn());
const mockWriteReleaseTags = vi.hoisted(() => vi.fn());

vi.mock('../discoverWorkspaces.ts', () => ({
  discoverWorkspaces: mockDiscoverWorkspaces,
}));

vi.mock('../loadConfig.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../loadConfig.ts')>();
  return {
    ...actual,
    loadConfig: mockLoadConfig,
  };
});

vi.mock('../releasePrepareMono.ts', () => ({
  releasePrepareMono: mockReleasePrepareMono,
}));

vi.mock('../releasePrepare.ts', () => ({
  releasePrepare: mockReleasePrepare,
}));

vi.mock('../runReleasePrepare.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runReleasePrepare.ts')>();
  return {
    ...actual,
    writeReleaseTags: mockWriteReleaseTags,
  };
});

import { prepareCommand } from '../prepareCommand.ts';

/** Sentinel error thrown by the mocked process.exit. */
class ExitError extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

describe(prepareCommand, () => {
  beforeEach(() => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/arrays', 'packages/strings']);
    mockLoadConfig.mockResolvedValue(undefined);
    mockReleasePrepareMono.mockReturnValue([]);
    mockReleasePrepare.mockReturnValue([]);
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitError(typeof code === 'number' ? code : undefined);
    });
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    mockDiscoverWorkspaces.mockReset();
    mockLoadConfig.mockReset();
    mockReleasePrepareMono.mockReset();
    mockReleasePrepare.mockReset();
    mockWriteReleaseTags.mockReset();
    vi.restoreAllMocks();
  });

  it('discovers workspaces and calls releasePrepareMono for a monorepo', async () => {
    await prepareCommand([]);

    expect(mockReleasePrepareMono).toHaveBeenCalledWith(
      expect.objectContaining({
        components: expect.arrayContaining([expect.objectContaining({ tagPrefix: 'arrays-v' })]),
      }),
      { dryRun: false, force: false },
    );
  });

  it('calls releasePrepare for a single-package repo', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(undefined);

    await prepareCommand([]);

    expect(mockReleasePrepare).toHaveBeenCalledWith(expect.objectContaining({ tagPrefix: 'v' }), {
      dryRun: false,
      force: false,
    });
  });

  it('passes dryRun from --dry-run flag', async () => {
    await prepareCommand(['--dry-run']);

    expect(mockReleasePrepareMono).toHaveBeenCalledWith(expect.any(Object), {
      dryRun: true,
      force: false,
    });
  });

  it('passes bumpOverride from --bump flag', async () => {
    await prepareCommand(['--bump=minor']);

    expect(mockReleasePrepareMono).toHaveBeenCalledWith(expect.any(Object), {
      dryRun: false,
      force: false,
      bumpOverride: 'minor',
    });
  });

  it('passes force from --force flag', async () => {
    await prepareCommand(['--force', '--bump=patch']);

    expect(mockReleasePrepareMono).toHaveBeenCalledWith(expect.any(Object), {
      dryRun: false,
      force: true,
      bumpOverride: 'patch',
    });
  });

  it('filters components when --only is provided', async () => {
    await prepareCommand(['--only=arrays']);

    expect(mockReleasePrepareMono).toHaveBeenCalledWith(
      expect.objectContaining({
        components: [expect.objectContaining({ tagPrefix: 'arrays-v' })],
      }),
      expect.any(Object),
    );
  });

  it('exits with error for --only on a single-package repo', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(undefined);

    await expect(prepareCommand(['--only=foo'])).rejects.toThrow(ExitError);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--only is only supported'));
  });

  it('exits with error for --only with an unknown component name in monorepo mode', async () => {
    await expect(prepareCommand(['--only=arrays,nonexistent'])).rejects.toThrow(ExitError);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('nonexistent'));
    expect(mockReleasePrepareMono).not.toHaveBeenCalled();
  });

  it('exits with error when loadConfig throws', async () => {
    mockLoadConfig.mockRejectedValue(new Error('parse error'));

    await expect(prepareCommand([])).rejects.toThrow(ExitError);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Error loading config'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('parse error'));
  });

  it('exits with error when config is invalid', async () => {
    mockLoadConfig.mockResolvedValue({ unknownField: true });

    await expect(prepareCommand([])).rejects.toThrow(ExitError);
    expect(console.error).toHaveBeenCalledWith('Invalid config:');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('unknownField'));
  });

  it('writes release tags after successful preparation', async () => {
    mockReleasePrepareMono.mockReturnValue(['arrays-v1.0.0']);

    await prepareCommand([]);

    expect(mockWriteReleaseTags).toHaveBeenCalledWith(['arrays-v1.0.0'], false);
  });

  it('prints release tags file path when tags are produced', async () => {
    mockReleasePrepareMono.mockReturnValue(['arrays-v1.0.0']);

    await prepareCommand([]);

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('Release tags file:'));
  });

  it('does not print release tags file path when no tags are produced', async () => {
    mockReleasePrepareMono.mockReturnValue([]);

    await prepareCommand([]);

    expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining('Release tags file:'));
  });

  it('applies component exclusion from config', async () => {
    mockLoadConfig.mockResolvedValue({
      components: [{ dir: 'strings', shouldExclude: true }],
    });

    await prepareCommand([]);

    expect(mockReleasePrepareMono).toHaveBeenCalledWith(
      expect.objectContaining({
        components: [expect.objectContaining({ tagPrefix: 'arrays-v' })],
      }),
      expect.any(Object),
    );
  });
});
