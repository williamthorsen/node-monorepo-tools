import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Leave every `vi.fn()` bare. An inline implementation infers a narrow `Mock<() => string>`, which no overloaded
// `node:fs` export accepts: `Mock<T>` derives its one call signature from `ReturnType<T>`, and that collapses an
// overload set to its last member. A bare `vi.fn()` stays `Mock<Procedure>`, whose `any` return satisfies every
// overload. Defaults belong in `beforeEach` below.
const mockExecFileSync = vi.hoisted(() => vi.fn());
const mockCopyFileSync = vi.hoisted(() => vi.fn());
const mockMkdtempSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockRmSync = vi.hoisted(() => vi.fn());
const mockTmpdir = vi.hoisted(() => vi.fn());

vi.mock(import('node:child_process'), () => ({ execFileSync: mockExecFileSync }));
vi.mock(import('node:fs'), () => ({
  copyFileSync: mockCopyFileSync,
  mkdtempSync: mockMkdtempSync,
  readFileSync: mockReadFileSync,
  rmSync: mockRmSync,
}));
vi.mock(import('node:os'), () => ({ tmpdir: mockTmpdir }));

import { GIT_CLIFF_VERSION, runGitCliff } from '../runGitCliff.ts';

/** The output path the helper derives from the mocked temp dir; asserted against in several cases. */
const OUTPUT_PATH = '/tmp/cliff-abc123/output.json';

/** The pinned npx package spec, built from the constant so a deliberate bump leaves these cases alone. */
const CLIFF_SPEC = `git-cliff@${GIT_CLIFF_VERSION}`;

describe(runGitCliff, () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockCopyFileSync.mockReset();
    mockMkdtempSync.mockReset().mockReturnValue('/tmp/cliff-abc123');
    mockReadFileSync.mockReset().mockReturnValue('');
    mockRmSync.mockReset();
    mockTmpdir.mockReset().mockReturnValue('/tmp');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('passes --prefer-offline and --yes to npx ahead of the pinned git-cliff spec', () => {
    runGitCliff('cliff.toml', ['--tag', 'v1.0.0']);

    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npx',
      ['--prefer-offline', '--yes', CLIFF_SPEC, '--config', 'cliff.toml', '--tag', 'v1.0.0', '--output', OUTPUT_PATH],
      expect.any(Object),
    );
  });

  it('pins an exact version, so npx has no range or tag left to resolve', () => {
    expect(GIT_CLIFF_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('sets npm_config_progress=false in the spawned env while preserving inherited variables', () => {
    const previousPath = process.env['PATH'];

    runGitCliff('cliff.toml', []);

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

  it('defaults RUST_LOG to warn, which drops cliff INFO output such as its update notice', () => {
    runGitCliff('cliff.toml', []);

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npx',
      expect.any(Array),
      expect.objectContaining({ env: expect.objectContaining({ RUST_LOG: 'warn' }) }),
    );
  });

  it('leaves an inherited RUST_LOG in place, so raising the level for debugging still works', () => {
    vi.stubEnv('RUST_LOG', 'debug');

    runGitCliff('cliff.toml', []);

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npx',
      expect.any(Array),
      expect.objectContaining({ env: expect.objectContaining({ RUST_LOG: 'debug' }) }),
    );
  });

  it('returns the contents of the file git-cliff wrote, not its stdout', () => {
    mockExecFileSync.mockReturnValueOnce('stdout that must be ignored');
    mockReadFileSync.mockReturnValueOnce('[{"version":"v1.0.0"}]');

    const result = runGitCliff('cliff.toml', []);

    expect(mockReadFileSync).toHaveBeenCalledWith(OUTPUT_PATH, 'utf8');
    expect(result).toBe('[{"version":"v1.0.0"}]');
  });

  it('appends --output after the caller args so a caller-supplied --output cannot win', () => {
    runGitCliff('cliff.toml', ['--output', '/caller/hijack.json']);

    // Both flags reach git-cliff; the helper's comes last, and clap takes the last occurrence.
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npx',
      [
        '--prefer-offline',
        '--yes',
        CLIFF_SPEC,
        '--config',
        'cliff.toml',
        '--output',
        '/caller/hijack.json',
        '--output',
        OUTPUT_PATH,
      ],
      expect.any(Object),
    );
  });

  it('discards stdout and inherits stderr, leaving no parent-side buffer to overflow', () => {
    runGitCliff('cliff.toml', []);

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npx',
      expect.any(Array),
      expect.objectContaining({ stdio: ['ignore', 'ignore', 'inherit'] }),
    );
  });

  it('copies a .template config to a temp .toml and uses the temp path as --config', () => {
    runGitCliff('/bundled/cliff.toml.template', ['--tag', 'v1.0.0']);

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

  it('passes a non-.template config path through unchanged without copying it', () => {
    runGitCliff('/explicit/cliff.toml', []);

    expect(mockCopyFileSync).not.toHaveBeenCalled();
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npx',
      expect.arrayContaining(['/explicit/cliff.toml']),
      expect.any(Object),
    );
  });

  it('removes the temp dir after a successful invocation', () => {
    runGitCliff('/bundled/cliff.toml.template', []);

    expect(mockRmSync).toHaveBeenCalledWith('/tmp/cliff-abc123', { recursive: true, force: true });
  });

  it('removes the temp dir for a non-.template config', () => {
    runGitCliff('/explicit/cliff.toml', []);

    expect(mockMkdtempSync).toHaveBeenCalledWith('/tmp/cliff-');
    expect(mockRmSync).toHaveBeenCalledWith('/tmp/cliff-abc123', { recursive: true, force: true });
  });

  it('removes the temp dir even when execFileSync throws', () => {
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error('git-cliff failed');
    });

    expect(() => runGitCliff('/bundled/cliff.toml.template', [])).toThrow('git-cliff failed');
    expect(mockRmSync).toHaveBeenCalledWith('/tmp/cliff-abc123', { recursive: true, force: true });
  });

  it('removes the temp dir even when readFileSync throws', () => {
    mockReadFileSync.mockImplementationOnce(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    expect(() => runGitCliff('cliff.toml', [])).toThrow('ENOENT');
    expect(mockRmSync).toHaveBeenCalledWith('/tmp/cliff-abc123', { recursive: true, force: true });
  });

  it('removes the temp dir when copyFileSync throws after mkdtempSync succeeds', () => {
    mockCopyFileSync.mockImplementationOnce(() => {
      throw new Error('template unreadable');
    });

    expect(() => runGitCliff('/bundled/cliff.toml.template', [])).toThrow('template unreadable');
    expect(mockMkdtempSync).toHaveBeenCalledWith('/tmp/cliff-');
    expect(mockRmSync).toHaveBeenCalledWith('/tmp/cliff-abc123', { recursive: true, force: true });
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('rethrows the underlying execFileSync error without wrapping it', () => {
    const underlying = new Error('npx exited with code 1');
    mockExecFileSync.mockImplementationOnce(() => {
      throw underlying;
    });

    expect(() => runGitCliff('cliff.toml', [])).toThrow(underlying);
  });
});
