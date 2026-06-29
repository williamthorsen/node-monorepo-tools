import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import process from 'node:process';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { runCommand } from '../runner.ts';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

const mockedSpawnSync = vi.mocked(spawnSync);

function spawnResult(
  overrides: Partial<SpawnSyncReturns<Buffer<ArrayBuffer>>> = {},
): SpawnSyncReturns<Buffer<ArrayBuffer>> {
  return {
    pid: 1234,
    output: [null, null, null],
    stdout: Buffer.from(''),
    stderr: Buffer.from(''),
    status: 0,
    signal: null,
    ...overrides,
  };
}

/** Reads the stdio array passed to spawnSync from the nth call. Throws if no such call was made. */
function stdioFromCall(callIndex: number): Array<'pipe' | 'inherit' | 'ignore' | number | null | undefined> {
  const call = mockedSpawnSync.mock.calls[callIndex];
  if (!call) throw new Error(`No spawnSync call at index ${callIndex}`);
  const options = call[2];
  if (!options || !Array.isArray(options.stdio)) throw new Error('Expected stdio to be an array');
  return options.stdio.filter(
    (entry): entry is 'pipe' | 'inherit' | 'ignore' | number | null | undefined =>
      entry === 'pipe' ||
      entry === 'inherit' ||
      entry === 'ignore' ||
      entry === null ||
      entry === undefined ||
      typeof entry === 'number',
  );
}

describe(runCommand, () => {
  let stderrWriteSpy: MockInstance;
  let stdoutWriteSpy: MockInstance;

  beforeEach(() => {
    mockedSpawnSync.mockReset();
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('without quiet option', () => {
    it('inherits stdio from process streams by default', () => {
      mockedSpawnSync.mockReturnValue(spawnResult());

      const code = runCommand('echo hello', '/tmp');

      expect(code).toBe(0);
      const callOptions = mockedSpawnSync.mock.calls[0]?.[2];
      expect(callOptions).toMatchObject({
        shell: true,
        cwd: '/tmp',
      });
      const stdio = stdioFromCall(0);
      // process.stdout/stderr expose numeric fds in Node — channels should be those fds, not 'pipe'.
      expect(stdio[0]).toBe('inherit');
      expect(typeof stdio[1]).toBe('number');
      expect(typeof stdio[2]).toBe('number');
    });

    it('returns the exit code on failure', () => {
      mockedSpawnSync.mockReturnValue(spawnResult({ status: 2 }));

      const code = runCommand('failing-command');

      expect(code).toBe(2);
    });

    it('returns 1 when the process is terminated by a signal (status null)', () => {
      mockedSpawnSync.mockReturnValue(spawnResult({ status: null, signal: 'SIGTERM' }));

      const code = runCommand('killed-command');

      expect(code).toBe(1);
    });

    it('returns 1 and writes the canonical Error line for the spawn error when spawn fails', () => {
      mockedSpawnSync.mockReturnValue(
        spawnResult({ status: null, error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) }),
      );

      const code = runCommand('nonexistent-bin');

      expect(code).toBe(1);
      expect(stderrWriteSpy).toHaveBeenCalledWith('Error: ENOENT\n');
    });

    it('forwards captured stdout into a caller-supplied PassThrough stream', () => {
      const captured: Buffer[] = [];
      const stdoutStream = new PassThrough();
      stdoutStream.on('data', (chunk: Buffer) => captured.push(chunk));

      mockedSpawnSync.mockReturnValue(spawnResult({ stdout: Buffer.from('hello world\n') }));

      const code = runCommand('echo hello world', undefined, { stdout: stdoutStream });

      expect(code).toBe(0);
      // PassThrough has no numeric fd, so the runner must use 'pipe' and forward the buffer.
      expect(stdioFromCall(0)[1]).toBe('pipe');
      expect(Buffer.concat(captured).toString('utf8')).toBe('hello world\n');
    });

    it('forwards captured stderr into a caller-supplied PassThrough stream', () => {
      const captured: Buffer[] = [];
      const stderrStream = new PassThrough();
      stderrStream.on('data', (chunk: Buffer) => captured.push(chunk));

      mockedSpawnSync.mockReturnValue(spawnResult({ stderr: Buffer.from('warning\n') }));

      const code = runCommand('noisy-command', undefined, { stderr: stderrStream });

      expect(code).toBe(0);
      expect(stdioFromCall(0)[2]).toBe('pipe');
      expect(Buffer.concat(captured).toString('utf8')).toBe('warning\n');
    });

    it('passes caller-supplied env to spawnSync', () => {
      mockedSpawnSync.mockReturnValue(spawnResult());

      runCommand('echo $FOO', undefined, { env: { FOO: 'bar' } });

      expect(mockedSpawnSync.mock.calls[0]?.[2]?.env).toStrictEqual({ FOO: 'bar' });
    });
  });

  describe('with quiet option', () => {
    it('uses pipe for both stdio channels', () => {
      mockedSpawnSync.mockReturnValue(spawnResult({ stdout: Buffer.from('some output') }));

      const code = runCommand('echo hello', '/tmp', { quiet: true });

      expect(code).toBe(0);
      const stdio = stdioFromCall(0);
      expect(stdio[1]).toBe('pipe');
      expect(stdio[2]).toBe('pipe');
    });

    it('does not write any output on success', () => {
      mockedSpawnSync.mockReturnValue(spawnResult({ stdout: Buffer.from('some output') }));

      runCommand('echo hello', undefined, { quiet: true });

      expect(stderrWriteSpy).not.toHaveBeenCalled();
      expect(stdoutWriteSpy).not.toHaveBeenCalled();
    });

    it('writes captured stdout and stderr to process.stderr on failure by default', () => {
      const stdout = Buffer.from('lint errors\n');
      const stderr = Buffer.from('error details\n');
      mockedSpawnSync.mockReturnValue(spawnResult({ status: 1, stdout, stderr }));

      const code = runCommand('lint', undefined, { quiet: true });

      expect(code).toBe(1);
      expect(stderrWriteSpy).toHaveBeenCalledWith(stdout);
      expect(stderrWriteSpy).toHaveBeenCalledWith(stderr);
    });

    it('writes quiet-mode failure output to caller-supplied stderr, not process.stderr', () => {
      const captured: Buffer[] = [];
      const stderrStream = new PassThrough();
      stderrStream.on('data', (chunk: Buffer) => captured.push(chunk));

      const stdout = Buffer.from('lint errors\n');
      const stderr = Buffer.from('error details\n');
      mockedSpawnSync.mockReturnValue(spawnResult({ status: 1, stdout, stderr }));

      const code = runCommand('lint', undefined, { quiet: true, stderr: stderrStream });

      expect(code).toBe(1);
      expect(stderrWriteSpy).not.toHaveBeenCalled();
      expect(Buffer.concat(captured).toString('utf8')).toBe('lint errors\nerror details\n');
    });

    it('skips writes when failure produces empty stdout and stderr buffers', () => {
      mockedSpawnSync.mockReturnValue(spawnResult({ status: 1, stdout: Buffer.from(''), stderr: Buffer.from('') }));

      const code = runCommand('lint', undefined, { quiet: true });

      expect(code).toBe(1);
      expect(stderrWriteSpy).not.toHaveBeenCalled();
    });
  });
});
