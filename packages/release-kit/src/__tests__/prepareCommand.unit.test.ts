import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockAssertCleanWorkingTree = vi.hoisted(() => vi.fn());
const mockBuildReleaseSummary = vi.hoisted(() => vi.fn());
const mockDiscoverWorkspaces = vi.hoisted(() => vi.fn());
const mockLoadConfig = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockReleasePrepareMono = vi.hoisted(() => vi.fn());
const mockReleasePrepare = vi.hoisted(() => vi.fn());
const mockWriteFileWithCheck = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readFileSync: mockReadFileSync,
  };
});

vi.mock('../assertCleanWorkingTree.ts', () => ({
  assertCleanWorkingTree: mockAssertCleanWorkingTree,
}));

vi.mock('../buildReleaseSummary.ts', () => ({
  buildReleaseSummary: mockBuildReleaseSummary,
}));

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

vi.mock(import('@williamthorsen/node-monorepo-core'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    writeFileWithCheck: mockWriteFileWithCheck,
  };
});

import { parseArgs, prepareCommand, RELEASE_SUMMARY_FILE, RELEASE_TAGS_FILE } from '../prepareCommand.ts';
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
    mockBuildReleaseSummary.mockReturnValue('');
    mockDiscoverWorkspaces.mockResolvedValue(['packages/arrays', 'packages/strings']);
    mockLoadConfig.mockResolvedValue(undefined);
    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath === 'packages/arrays/package.json') {
        return JSON.stringify({ name: '@scope/arrays' });
      }
      if (filePath === 'packages/strings/package.json') {
        return JSON.stringify({ name: '@scope/strings' });
      }
      throw new Error(`Unexpected readFileSync call for path: ${filePath}`);
    });
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
    mockAssertCleanWorkingTree.mockReset();
    mockBuildReleaseSummary.mockReset();
    mockDiscoverWorkspaces.mockReset();
    mockLoadConfig.mockReset();
    mockReadFileSync.mockReset();
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

  it('exits with a distinct error when writing release summary fails', async () => {
    mockBuildReleaseSummary.mockReturnValue('arrays-v1.0.0\n- feat: Something');
    mockReleasePrepareMono.mockReturnValue(makePrepareResult({ tags: ['arrays-v1.0.0'] }));
    mockWriteFileWithCheck.mockImplementation((_path: string) => {
      if (_path === RELEASE_SUMMARY_FILE) {
        return { filePath: RELEASE_SUMMARY_FILE, outcome: 'failed', error: 'permission denied' };
      }
      return { filePath: RELEASE_TAGS_FILE, outcome: 'created' };
    });

    await expect(prepareCommand([])).rejects.toThrow(ExitError);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('release summary'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('permission denied'));
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

  it('writes the release summary file when summary is non-empty', async () => {
    mockBuildReleaseSummary.mockReturnValue('release-kit-v2.4.0\n- feat: Add commit command');
    mockReleasePrepareMono.mockReturnValue(makePrepareResult({ tags: ['release-kit-v2.4.0'] }));

    await prepareCommand([]);

    expect(mockWriteFileWithCheck).toHaveBeenCalledWith(
      RELEASE_SUMMARY_FILE,
      'release-kit-v2.4.0\n- feat: Add commit command',
      { dryRun: false, overwrite: true },
    );
  });

  it('does not write the release summary file when summary is empty', async () => {
    mockBuildReleaseSummary.mockReturnValue('');
    mockReleasePrepareMono.mockReturnValue(makePrepareResult({ tags: ['core-v1.0.0'] }));

    await prepareCommand([]);

    expect(mockWriteFileWithCheck).not.toHaveBeenCalledWith(
      RELEASE_SUMMARY_FILE,
      expect.any(String),
      expect.any(Object),
    );
  });

  it('prints follow-up message after successful non-dry-run with tags', async () => {
    mockReleasePrepareMono.mockReturnValue(makePrepareResult({ tags: ['v1.0.0'] }));

    await prepareCommand([]);

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Run 'release-kit commit'"));
  });

  it('does not print follow-up message during dry run', async () => {
    mockReleasePrepareMono.mockReturnValue(makePrepareResult({ tags: ['v1.0.0'], dryRun: true }));

    await prepareCommand(['--dry-run']);

    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining("Run 'release-kit commit'"));
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

  it('exits with error when the working tree is dirty', async () => {
    mockAssertCleanWorkingTree.mockImplementation(() => {
      throw new Error('Working tree has uncommitted changes.');
    });

    await expect(prepareCommand([])).rejects.toThrow(ExitError);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('uncommitted changes'));
  });

  it('skips the clean-tree check when --no-git-checks is provided', async () => {
    await prepareCommand(['--no-git-checks']);

    expect(mockAssertCleanWorkingTree).not.toHaveBeenCalled();
  });

  it('skips the clean-tree check when -n is provided', async () => {
    await prepareCommand(['-n']);

    expect(mockAssertCleanWorkingTree).not.toHaveBeenCalled();
  });

  it('skips the clean-tree check during dry run', async () => {
    await prepareCommand(['--dry-run']);

    expect(mockAssertCleanWorkingTree).not.toHaveBeenCalled();
  });

  it('passes setVersion to releasePrepareMono when --only matches exactly one component', async () => {
    await prepareCommand(['--only=arrays', '--set-version=1.0.0']);

    expect(mockReleasePrepareMono).toHaveBeenCalledWith(
      expect.objectContaining({
        components: [expect.objectContaining({ tagPrefix: 'arrays-v' })],
      }),
      expect.objectContaining({ setVersion: '1.0.0' }),
    );
  });

  it('exits with an error when --set-version is used without --only in monorepo mode', async () => {
    await expect(prepareCommand(['--set-version=1.0.0'])).rejects.toThrow(ExitError);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--set-version requires --only'));
    expect(mockReleasePrepareMono).not.toHaveBeenCalled();
  });

  it('exits with an error when --only matches multiple components under --set-version', async () => {
    await expect(prepareCommand(['--only=arrays,strings', '--set-version=1.0.0'])).rejects.toThrow(ExitError);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('exactly one component'));
    expect(mockReleasePrepareMono).not.toHaveBeenCalled();
  });

  it('exits with the unknown-component error when --only matches zero components under --set-version', async () => {
    // A non-matching --only name is caught by the unknown-component guard in prepareCommand
    // (which runs before the --set-version narrowing check), so the error mentions the
    // unknown name rather than the "exactly one component" message.
    await expect(prepareCommand(['--only=nonexistent', '--set-version=1.0.0'])).rejects.toThrow(ExitError);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('nonexistent'));
    expect(mockReleasePrepareMono).not.toHaveBeenCalled();
  });

  it('passes setVersion to releasePrepare in single-package mode', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(undefined);

    await prepareCommand(['--set-version=1.2.3']);

    expect(mockReleasePrepare).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ setVersion: '1.2.3' }),
    );
  });
});

describe(parseArgs, () => {
  beforeEach(() => {
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitError(typeof code === 'number' ? code : undefined);
    });
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws for an invalid bump type', () => {
    expect(() => parseArgs(['--bump=invalid'])).toThrow('Invalid bump type');
  });

  it('throws for an unknown flag with the flag name in the message', () => {
    expect(() => parseArgs(['--foo'])).toThrow('Unknown option: --foo');
  });

  it('exits with code 0 when --help is provided', () => {
    expect(() => parseArgs(['--help'])).toThrow(ExitError);
    expect(process.exit).toHaveBeenCalledWith(0);
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('npx @williamthorsen/release-kit prepare'));
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('Force a release even when there are no commits since the last tag (requires --bump)'),
    );
  });

  it('throws when --force is used without --bump', () => {
    expect(() => parseArgs(['--force'])).toThrow('--force requires --bump');
  });

  it('throws when --only value is empty', () => {
    expect(() => parseArgs(['--only='])).toThrow('--only requires');
  });

  it('accepts a canonical semver value for --set-version', () => {
    const result = parseArgs(['--set-version=1.0.0']);
    expect(result.setVersion).toBe('1.0.0');
  });

  it('throws when --set-version has a pre-release suffix', () => {
    expect(() => parseArgs(['--set-version=1.0.0-alpha'])).toThrow('Invalid --set-version');
  });

  it('throws when --set-version is not canonical N.N.N', () => {
    expect(() => parseArgs(['--set-version=1.0'])).toThrow('Invalid --set-version');
  });

  it('throws when --set-version is empty', () => {
    expect(() => parseArgs(['--set-version='])).toThrow('--set-version requires');
  });

  it('throws when --set-version is combined with --bump', () => {
    expect(() => parseArgs(['--set-version=1.0.0', '--bump=minor'])).toThrow(
      '--set-version cannot be combined with --bump',
    );
  });

  it('throws when --set-version is combined with --force', () => {
    expect(() => parseArgs(['--set-version=1.0.0', '--force'])).toThrow(
      '--set-version cannot be combined with --force',
    );
  });

  it('parses --no-git-checks flag', () => {
    const result = parseArgs(['--no-git-checks']);
    expect(result.noGitChecks).toBe(true);
  });

  it('parses -n as shorthand for --no-git-checks', () => {
    const result = parseArgs(['-n']);
    expect(result.noGitChecks).toBe(true);
  });

  it('defaults noGitChecks to false', () => {
    const result = parseArgs([]);
    expect(result.noGitChecks).toBe(false);
  });
});

describe('RELEASE_TAGS_FILE', () => {
  it('points to tmp/ relative to the project root', () => {
    expect(RELEASE_TAGS_FILE).toBe('tmp/.release-tags');
  });
});

describe('RELEASE_SUMMARY_FILE', () => {
  it('points to tmp/ relative to the project root', () => {
    expect(RELEASE_SUMMARY_FILE).toBe('tmp/.release-summary');
  });
});
