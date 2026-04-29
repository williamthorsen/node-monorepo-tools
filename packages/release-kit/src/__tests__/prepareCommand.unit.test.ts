import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockAssertCleanWorkingTree = vi.hoisted(() => vi.fn());
const mockBuildReleaseSummary = vi.hoisted(() => vi.fn());
const mockDiscoverWorkspaces = vi.hoisted(() => vi.fn());
const mockGetCommitsSinceTarget = vi.hoisted(() => vi.fn());
const mockLoadConfig = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockReleasePrepareMono = vi.hoisted(() => vi.fn());
const mockReleasePrepare = vi.hoisted(() => vi.fn());
const mockWriteFileWithCheck = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

vi.mock('../assertCleanWorkingTree.ts', () => ({
  assertCleanWorkingTree: mockAssertCleanWorkingTree,
}));

vi.mock('../buildReleaseSummary.ts', () => ({
  buildReleaseSummary: mockBuildReleaseSummary,
}));

vi.mock('../discoverWorkspaces.ts', () => ({
  discoverWorkspaces: mockDiscoverWorkspaces,
}));

vi.mock('../getCommitsSinceTarget.ts', () => ({
  getCommitsSinceTarget: mockGetCommitsSinceTarget,
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

vi.mock(import('@williamthorsen/nmr-core'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    writeFileWithCheck: mockWriteFileWithCheck,
  };
});

import { parseArgs, prepareCommand, RELEASE_SUMMARY_FILE, RELEASE_TAGS_FILE } from '../prepareCommand.ts';
import type { PrepareResult } from '../types.ts';

describe(prepareCommand, () => {
  beforeEach(() => {
    mockBuildReleaseSummary.mockReturnValue('');
    mockDiscoverWorkspaces.mockResolvedValue(['packages/arrays', 'packages/strings']);
    mockLoadConfig.mockResolvedValue(undefined);
    // Default: pretend the root package.json does not exist. Tests that exercise the project
    // block override this in-test to return a valid version.
    mockExistsSync.mockReturnValue(false);
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
    // Default: no commits anywhere, so the stranded-dependents validator stays silent.
    mockGetCommitsSinceTarget.mockReturnValue({ tag: undefined, commits: [] });
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
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockReleasePrepareMono.mockReset();
    mockReleasePrepare.mockReset();
    mockGetCommitsSinceTarget.mockReset();
    mockWriteFileWithCheck.mockReset();
    vi.restoreAllMocks();
  });

  it('discovers workspaces and calls releasePrepareMono for a monorepo', async () => {
    await prepareCommand([]);

    expect(mockReleasePrepareMono).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaces: expect.arrayContaining([expect.objectContaining({ tagPrefix: 'arrays-v' })]),
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

  it('filters workspaces when --only is provided', async () => {
    await prepareCommand(['--only=arrays']);

    expect(mockReleasePrepareMono).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaces: [expect.objectContaining({ tagPrefix: 'arrays-v' })],
      }),
      expect.any(Object),
    );
  });

  it('exits with error for --only on a single-package repo', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(undefined);

    await expect(prepareCommand(['--only=foo'])).rejects.toThrow(ExitError);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--only is only supported'));
  });

  it('exits with error for --force without --bump on a single-package repo', async () => {
    // The orthogonal --force model is only wired into the monorepo executor; the
    // single-package path still uses determineBumpFromCommits, so a bare --force would
    // be silently ignored. Reject it explicitly with a guidance error instead.
    mockDiscoverWorkspaces.mockResolvedValue(undefined);

    await expect(prepareCommand(['--force'])).rejects.toThrow(ExitError);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--force without --bump'));
    expect(mockReleasePrepare).not.toHaveBeenCalled();
  });

  it('accepts --force --bump=X on a single-package repo', async () => {
    // --bump=X carries the release through unconditionally in the single-package path,
    // so --force is a no-op rather than a silent failure when paired with --bump.
    mockDiscoverWorkspaces.mockResolvedValue(undefined);

    await prepareCommand(['--force', '--bump=patch']);

    expect(mockReleasePrepare).toHaveBeenCalledWith(expect.any(Object), {
      dryRun: false,
      force: true,
      bumpOverride: 'patch',
    });
  });

  it('exits with error for --only with an unknown workspace name in monorepo mode', async () => {
    await expect(prepareCommand(['--only=arrays,nonexistent'])).rejects.toThrow(ExitError);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('nonexistent'));
    expect(mockReleasePrepareMono).not.toHaveBeenCalled();
  });

  it('rejects --only when an excluded internal dependent has its own changes', async () => {
    // Arrange a graph where strings depends on arrays, and both have commits since their last tag.
    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath === 'packages/arrays/package.json') {
        return JSON.stringify({ name: '@scope/arrays' });
      }
      if (filePath === 'packages/strings/package.json') {
        return JSON.stringify({ name: '@scope/strings', dependencies: { '@scope/arrays': 'workspace:*' } });
      }
      throw new Error(`Unexpected readFileSync call for path: ${filePath}`);
    });
    mockGetCommitsSinceTarget.mockImplementation((tagPrefixes: readonly string[]) => {
      if (tagPrefixes.includes('arrays-v'))
        return { tag: 'arrays-v1.0.0', commits: [{ message: 'feat: x', hash: 'h1' }] };
      if (tagPrefixes.includes('strings-v'))
        return { tag: 'strings-v1.0.0', commits: [{ message: 'feat: y', hash: 'h2' }] };
      return { tag: undefined, commits: [] };
    });

    await expect(prepareCommand(['--only=arrays'])).rejects.toThrow(ExitError);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('stranded by the release'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('strings'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('downstream of arrays'));
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

  it('prints stage-attributed errors verbatim without an outer "Error preparing release:" prefix', async () => {
    mockReleasePrepareMono.mockImplementation(() => {
      throw new Error("workspace 'arrays' release stage: bumpAllVersions failed: ENOENT");
    });

    await expect(prepareCommand([])).rejects.toThrow(ExitError);
    expect(console.error).toHaveBeenCalledWith("workspace 'arrays' release stage: bumpAllVersions failed: ENOENT");
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('Error preparing release'));
  });

  it('prints validation errors verbatim without an outer "Error preparing release:" prefix', async () => {
    mockReleasePrepareMono.mockImplementation(() => {
      throw new Error('--set-version 0.3.0 is not greater than current version 0.5.0');
    });

    await expect(prepareCommand([])).rejects.toThrow(ExitError);
    expect(console.error).toHaveBeenCalledWith('--set-version 0.3.0 is not greater than current version 0.5.0');
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('Error preparing release'));
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

  it('applies workspace exclusion from config', async () => {
    mockLoadConfig.mockResolvedValue({
      workspaces: [{ dir: 'strings', shouldExclude: true }],
    });

    await prepareCommand([]);

    expect(mockReleasePrepareMono).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaces: [expect.objectContaining({ tagPrefix: 'arrays-v' })],
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

  it('passes setVersion to releasePrepareMono when --only matches exactly one workspace', async () => {
    await prepareCommand(['--only=arrays', '--set-version=1.0.0']);

    expect(mockReleasePrepareMono).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaces: [expect.objectContaining({ tagPrefix: 'arrays-v' })],
      }),
      expect.objectContaining({ setVersion: '1.0.0' }),
    );
  });

  it('exits with an error when --set-version is used without --only in monorepo mode', async () => {
    await expect(prepareCommand(['--set-version=1.0.0'])).rejects.toThrow(ExitError);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--set-version requires --only'));
    expect(mockReleasePrepareMono).not.toHaveBeenCalled();
  });

  it('exits with an error when --only matches multiple workspaces under --set-version', async () => {
    await expect(prepareCommand(['--only=arrays,strings', '--set-version=1.0.0'])).rejects.toThrow(ExitError);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('exactly one workspace'));
    expect(mockReleasePrepareMono).not.toHaveBeenCalled();
  });

  it('exits with the unknown-workspace error when --only matches zero workspaces under --set-version', async () => {
    // A non-matching --only name is caught by the unknown-workspace guard in prepareCommand
    // (which runs before the --set-version narrowing check), so the error mentions the
    // unknown name rather than the "exactly one workspace" message.
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

  it('forwards withReleaseNotes to releasePrepareMono when --with-release-notes is set', async () => {
    await prepareCommand(['--with-release-notes']);

    expect(mockReleasePrepareMono).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ withReleaseNotes: true }),
    );
  });

  it('forwards withReleaseNotes to releasePrepare in single-package mode', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(undefined);

    await prepareCommand(['--with-release-notes']);

    expect(mockReleasePrepare).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ withReleaseNotes: true }),
    );
  });

  it('omits withReleaseNotes from options when the flag is not set', async () => {
    await prepareCommand([]);

    const callArgs = mockReleasePrepareMono.mock.calls[0]?.[1];
    expect(callArgs).not.toHaveProperty('withReleaseNotes');
  });

  describe('--only and --set-version interactions with project block', () => {
    beforeEach(() => {
      // Configure the mocks so the project block is loaded and the root package.json is valid.
      mockLoadConfig.mockResolvedValue({ project: {} });
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((filePath: string) => {
        if (filePath === 'packages/arrays/package.json') {
          return JSON.stringify({ name: '@scope/arrays' });
        }
        if (filePath === 'packages/strings/package.json') {
          return JSON.stringify({ name: '@scope/strings' });
        }
        // Root package.json for the project block prerequisite check.
        return JSON.stringify({ name: 'root', version: '0.9.0' });
      });
    });

    it('rejects --only with an error before any release work runs', async () => {
      await expect(prepareCommand(['--only=arrays'])).rejects.toThrow(ExitError);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('--only cannot be combined with a project release'),
      );
      expect(mockReleasePrepareMono).not.toHaveBeenCalled();
    });

    it('runs normally without --only when project is configured', async () => {
      await prepareCommand([]);
      expect(mockReleasePrepareMono).toHaveBeenCalled();
    });

    it('rejects --set-version with the project-aware error (not the transitive --only error)', async () => {
      await expect(prepareCommand(['--set-version=1.2.3'])).rejects.toThrow(ExitError);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('--set-version cannot be combined with a project release'),
      );
      expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('requires --only'));
      expect(mockReleasePrepareMono).not.toHaveBeenCalled();
    });

    it('rejects --set-version + --only with the project-aware error (project rule wins over --only rule)', async () => {
      await expect(prepareCommand(['--set-version=1.2.3', '--only=arrays'])).rejects.toThrow(ExitError);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('--set-version cannot be combined with a project release'),
      );
      expect(mockReleasePrepareMono).not.toHaveBeenCalled();
    });
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
      expect.stringContaining('Release even when no commits or no bump-worthy commits exist'),
    );
  });

  it('accepts --force without --bump and defaults force to true', () => {
    // `--force` is a pure release trigger; runtime defaults the level to patch when no
    // `--bump` is supplied. Parsing must accept the flag without requiring `--bump`.
    const result = parseArgs(['--force']);
    expect(result.force).toBe(true);
    expect(result.bumpOverride).toBeUndefined();
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

  it('parses --with-release-notes flag', () => {
    const result = parseArgs(['--with-release-notes']);
    expect(result.withReleaseNotes).toBe(true);
  });

  it('defaults withReleaseNotes to false', () => {
    const result = parseArgs([]);
    expect(result.withReleaseNotes).toBe(false);
  });

  it('documents --with-release-notes in --help output', () => {
    expect(() => parseArgs(['--help'])).toThrow(ExitError);
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('--with-release-notes'));
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

// region | Helpers
/** Sentinel error thrown by the mocked process.exit. */
class ExitError extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

/** Build a minimal PrepareResult for mocking. */
function makePrepareResult(overrides?: Partial<PrepareResult>): PrepareResult {
  return {
    workspaces: [],
    tags: [],
    dryRun: false,
    ...overrides,
  };
}
// endregion | Helpers
