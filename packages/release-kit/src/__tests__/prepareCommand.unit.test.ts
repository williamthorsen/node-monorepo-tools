import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockDiscoverWorkspaces = vi.hoisted(() => vi.fn());
const mockLoadConfig = vi.hoisted(() => vi.fn());
const mockReleasePrepareMono = vi.hoisted(() => vi.fn());
const mockReleasePrepare = vi.hoisted(() => vi.fn());
const mockWriteFileWithCheck = vi.hoisted(() => vi.fn());

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

vi.mock(import('@williamthorsen/node-monorepo-core'), () => ({
  writeFileWithCheck: mockWriteFileWithCheck,
}));

import { parseArgs, prepareCommand, RELEASE_TAGS_FILE } from '../prepareCommand.ts';
import type { PrepareResult } from '../types.ts';

/** Sentinel error thrown by the mocked process.exit. */
class ExitError extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

/** Build a minimal PrepareResult for mocking. */
function makePrepareResult(overrides?: Partial<PrepareResult>): PrepareResult {
  return {
    components: [],
    tags: [],
    dryRun: false,
    ...overrides,
  };
}

describe(prepareCommand, () => {
  beforeEach(() => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/arrays', 'packages/strings']);
    mockLoadConfig.mockResolvedValue(undefined);
    mockReleasePrepareMono.mockReturnValue(makePrepareResult());
    mockReleasePrepare.mockReturnValue(makePrepareResult());
    mockWriteFileWithCheck.mockReturnValue({ filePath: RELEASE_TAGS_FILE, outcome: 'created' });
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitError(typeof code === 'number' ? code : undefined);
    });
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    mockDiscoverWorkspaces.mockReset();
    mockLoadConfig.mockReset();
    mockReleasePrepareMono.mockReset();
    mockReleasePrepare.mockReset();
    mockWriteFileWithCheck.mockReset();
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
    mockWriteFileWithCheck.mockReturnValue({ filePath: RELEASE_TAGS_FILE, outcome: 'created' });
    mockReleasePrepareMono.mockReturnValue(makePrepareResult({ tags: ['arrays-v1.0.0'] }));

    await prepareCommand([]);

    expect(mockWriteFileWithCheck).toHaveBeenCalledWith(RELEASE_TAGS_FILE, 'arrays-v1.0.0', {
      dryRun: false,
      overwrite: true,
    });
  });

  it('passes dryRun to writeFileWithCheck during a dry run', async () => {
    mockWriteFileWithCheck.mockReturnValue({ filePath: RELEASE_TAGS_FILE, outcome: 'created' });
    mockReleasePrepareMono.mockReturnValue(makePrepareResult({ tags: ['arrays-v1.0.0'], dryRun: true }));

    await prepareCommand(['--dry-run']);

    expect(mockWriteFileWithCheck).toHaveBeenCalledWith(RELEASE_TAGS_FILE, 'arrays-v1.0.0', {
      dryRun: true,
      overwrite: true,
    });
  });

  it('joins multiple tags with newlines in the release tags file', async () => {
    mockWriteFileWithCheck.mockReturnValue({ filePath: RELEASE_TAGS_FILE, outcome: 'created' });
    mockReleasePrepareMono.mockReturnValue(makePrepareResult({ tags: ['arrays-v1.0.0', 'strings-v2.0.1'] }));

    await prepareCommand([]);

    expect(mockWriteFileWithCheck).toHaveBeenCalledWith(
      RELEASE_TAGS_FILE,
      'arrays-v1.0.0\nstrings-v2.0.1',
      expect.any(Object),
    );
  });

  it('exits with a distinct error when writing release tags fails', async () => {
    mockWriteFileWithCheck.mockReturnValue({
      filePath: RELEASE_TAGS_FILE,
      outcome: 'failed',
      error: 'permission denied',
    });
    mockReleasePrepareMono.mockReturnValue(makePrepareResult({ tags: ['arrays-v1.0.0'] }));

    await expect(prepareCommand([])).rejects.toThrow(ExitError);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('release tags'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('permission denied'));
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('Error preparing release'));
  });

  it('prints release tags file path when tags are produced', async () => {
    mockReleasePrepareMono.mockReturnValue(makePrepareResult({ tags: ['arrays-v1.0.0'] }));

    await prepareCommand([]);

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('Release tags file:'));
  });

  it('does not print release tags file path during a dry run', async () => {
    mockReleasePrepareMono.mockReturnValue(makePrepareResult({ tags: ['arrays-v1.0.0'], dryRun: true }));

    await prepareCommand(['--dry-run']);

    expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining('Release tags file:'));
  });

  it('does not print release tags file path when no tags are produced', async () => {
    mockReleasePrepareMono.mockReturnValue(makePrepareResult());

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

  it('writes the result of reportPrepare to stdout', async () => {
    mockReleasePrepareMono.mockReturnValue(makePrepareResult());

    await prepareCommand([]);

    expect(process.stdout.write).toHaveBeenCalledWith(expect.any(String));
  });
});

describe(parseArgs, () => {
  beforeEach(() => {
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitError(typeof code === 'number' ? code : undefined);
    });
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits with code 1 for an invalid bump type', () => {
    expect(() => parseArgs(['--bump=invalid'])).toThrow(ExitError);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Invalid bump type'));
  });

  it('exits with code 1 for an unknown argument', () => {
    expect(() => parseArgs(['--foo'])).toThrow(ExitError);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Unknown argument'));
  });

  it('exits with code 0 when --help is provided', () => {
    expect(() => parseArgs(['--help'])).toThrow(ExitError);
    expect(process.exit).toHaveBeenCalledWith(0);
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('npx @williamthorsen/release-kit prepare'));
  });

  it('exits with code 1 when --force is used without --bump', () => {
    expect(() => parseArgs(['--force'])).toThrow(ExitError);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--force requires --bump'));
  });

  it('exits with code 1 when --only value is empty', () => {
    expect(() => parseArgs(['--only='])).toThrow(ExitError);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--only requires'));
  });
});

describe('RELEASE_TAGS_FILE', () => {
  it('points to tmp/ relative to the project root', () => {
    expect(RELEASE_TAGS_FILE).toBe('tmp/.release-tags');
  });
});
