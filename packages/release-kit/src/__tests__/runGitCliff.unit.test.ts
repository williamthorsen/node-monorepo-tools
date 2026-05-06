import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());
const mockCopyFileSync = vi.hoisted(() => vi.fn());
const mockMkdtempSync = vi.hoisted(() => vi.fn(() => '/tmp/cliff-abc123'));
const mockRmSync = vi.hoisted(() => vi.fn());
const mockTmpdir = vi.hoisted(() => vi.fn(() => '/tmp'));

vi.mock('node:child_process', () => ({ execFileSync: mockExecFileSync }));
vi.mock('node:fs', () => ({ copyFileSync: mockCopyFileSync, mkdtempSync: mockMkdtempSync, rmSync: mockRmSync }));
vi.mock('node:os', () => ({ tmpdir: mockTmpdir }));

import { refreshGitCliffCache, runGitCliff } from '../runGitCliff.ts';

describe(runGitCliff, () => {
  afterEach(() => {
    mockExecFileSync.mockReset();
    mockCopyFileSync.mockReset();
    mockMkdtempSync.mockReset().mockReturnValue('/tmp/cliff-abc123');
    mockRmSync.mockReset();
    mockTmpdir.mockReset().mockReturnValue('/tmp');
  });

  it('passes --prefer-offline and --yes to npx ahead of git-cliff', () => {
    mockExecFileSync.mockReturnValueOnce('');

    runGitCliff('cliff.toml', ['--tag', 'v1.0.0'], 'inherit');

    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npx',
      ['--prefer-offline', '--yes', 'git-cliff', '--config', 'cliff.toml', '--tag', 'v1.0.0'],
      expect.any(Object),
    );
  });

  it('sets npm_config_progress=false in the spawned env while preserving inherited variables', () => {
    mockExecFileSync.mockReturnValueOnce('');
    const previousPath = process.env.PATH;

    runGitCliff('cliff.toml', [], 'inherit');

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npx',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          npm_config_progress: 'false',
          // Sanity: an arbitrary inherited variable is still present (env merge does not clobber the inherited environment).
          PATH: previousPath,
        }),
      }),
    );
  });

  it('forces utf8 encoding so the return type is string', () => {
    mockExecFileSync.mockReturnValueOnce('cliff stdout');

    const result = runGitCliff('cliff.toml', [], ['pipe', 'pipe', 'inherit']);

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npx',
      expect.any(Array),
      expect.objectContaining({ encoding: 'utf8' }),
    );
    expect(result).toBe('cliff stdout');
  });

  it('passes the caller-supplied stdio value through to execFileSync', () => {
    mockExecFileSync.mockReturnValueOnce('');

    runGitCliff('cliff.toml', [], ['pipe', 'pipe', 'inherit']);

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npx',
      expect.any(Array),
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'inherit'] }),
    );
  });

  it('copies a .template config to a temp .toml and uses the temp path as --config', () => {
    mockExecFileSync.mockReturnValueOnce('');

    runGitCliff('/bundled/cliff.toml.template', ['--tag', 'v1.0.0'], 'inherit');

    expect(mockMkdtempSync).toHaveBeenCalledWith('/tmp/cliff-');
    expect(mockCopyFileSync).toHaveBeenCalledWith('/bundled/cliff.toml.template', '/tmp/cliff-abc123/cliff.toml');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npx',
      expect.arrayContaining(['/tmp/cliff-abc123/cliff.toml']),
      expect.any(Object),
    );
    expect(mockExecFileSync).not.toHaveBeenCalledWith(
      'npx',
      expect.arrayContaining(['/bundled/cliff.toml.template']),
      expect.any(Object),
    );
  });

  it('passes a non-.template config path through unchanged without creating a temp dir', () => {
    mockExecFileSync.mockReturnValueOnce('');

    runGitCliff('/explicit/cliff.toml', [], 'inherit');

    expect(mockMkdtempSync).not.toHaveBeenCalled();
    expect(mockCopyFileSync).not.toHaveBeenCalled();
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npx',
      expect.arrayContaining(['/explicit/cliff.toml']),
      expect.any(Object),
    );
  });

  it('removes the temp dir after a successful invocation when a .template was used', () => {
    mockExecFileSync.mockReturnValueOnce('');

    runGitCliff('/bundled/cliff.toml.template', [], 'inherit');

    expect(mockRmSync).toHaveBeenCalledWith('/tmp/cliff-abc123', { recursive: true, force: true });
  });

  it('removes the temp dir even when execFileSync throws', () => {
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error('git-cliff failed');
    });

    expect(() => runGitCliff('/bundled/cliff.toml.template', [], 'inherit')).toThrow('git-cliff failed');
    expect(mockRmSync).toHaveBeenCalledWith('/tmp/cliff-abc123', { recursive: true, force: true });
  });

  it('removes the temp dir when copyFileSync throws after mkdtempSync succeeds', () => {
    mockCopyFileSync.mockImplementationOnce(() => {
      throw new Error('template unreadable');
    });

    expect(() => runGitCliff('/bundled/cliff.toml.template', [], 'inherit')).toThrow('template unreadable');
    expect(mockMkdtempSync).toHaveBeenCalledWith('/tmp/cliff-');
    expect(mockRmSync).toHaveBeenCalledWith('/tmp/cliff-abc123', { recursive: true, force: true });
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('rethrows the underlying execFileSync error without wrapping it', () => {
    const underlying = new Error('npx exited with code 1');
    mockExecFileSync.mockImplementationOnce(() => {
      throw underlying;
    });

    expect(() => runGitCliff('cliff.toml', [], 'inherit')).toThrow(underlying);
  });

  it('does not invoke rmSync when no temp dir was created (non-.template path)', () => {
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error('git-cliff failed');
    });

    expect(() => runGitCliff('/explicit/cliff.toml', [], 'inherit')).toThrow('git-cliff failed');
    expect(mockRmSync).not.toHaveBeenCalled();
  });
});

describe(refreshGitCliffCache, () => {
  afterEach(() => {
    mockExecFileSync.mockReset();
  });

  it('invokes npx --yes git-cliff --version without --prefer-offline', () => {
    mockExecFileSync.mockReturnValueOnce('');

    refreshGitCliffCache();

    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
    expect(mockExecFileSync).toHaveBeenCalledWith('npx', ['--yes', 'git-cliff', '--version'], expect.any(Object));
    // The omission of --prefer-offline is the whole point of this helper.
    const [, args] = mockExecFileSync.mock.calls[0] ?? [];
    expect(args).not.toContain('--prefer-offline');
    // No --config: the warmup does not need a cliff config to revalidate the cache.
    expect(args).not.toContain('--config');
  });

  it('uses stdio ["ignore", "pipe", "inherit"] so the version line is suppressed but errors surface', () => {
    mockExecFileSync.mockReturnValueOnce('');

    refreshGitCliffCache();

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npx',
      expect.any(Array),
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'inherit'] }),
    );
  });

  it('sets npm_config_progress=false in the spawned env while preserving inherited variables', () => {
    mockExecFileSync.mockReturnValueOnce('');
    const previousPath = process.env.PATH;

    refreshGitCliffCache();

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npx',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          npm_config_progress: 'false',
          PATH: previousPath,
        }),
      }),
    );
  });

  it('rethrows the underlying execFileSync error without wrapping it', () => {
    const underlying = new Error('npx exited with code 1');
    mockExecFileSync.mockImplementationOnce(() => {
      throw underlying;
    });

    // Capture and assert reference identity; `toThrow(underlying)` matches by message/class
    // and would pass even if the helper wrapped the error in a fresh Error with the same
    // message string.
    let caught: unknown;
    try {
      refreshGitCliffCache();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(underlying);
  });
});
