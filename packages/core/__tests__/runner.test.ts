import { execSync } from 'node:child_process';
import process from 'node:process';

import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCommand } from '../src/runner.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

const mockedExecSync = vi.mocked(execSync);

describe(runCommand, () => {
  let stderrWriteSpy: MockInstance;
  let stdoutWriteSpy: MockInstance;

  beforeEach(() => {
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('without quiet option', () => {
    it('calls execSync with stdio inherit', () => {
      mockedExecSync.mockReturnValue(Buffer.from(''));

      const code = runCommand('echo hello', '/tmp');

      expect(code).toBe(0);
      expect(mockedExecSync).toHaveBeenCalledWith('echo hello', {
        stdio: 'inherit',
        cwd: '/tmp',
      });
    });

    it('returns the exit code on failure', () => {
      const error = Object.assign(new Error('command failed'), { status: 2 });
      mockedExecSync.mockImplementation(() => {
        throw error;
      });

      const code = runCommand('failing-command');

      expect(code).toBe(2);
    });
  });

  describe('with quiet option', () => {
    it('calls execSync with stdio pipe', () => {
      mockedExecSync.mockReturnValue(Buffer.from('some output'));

      const code = runCommand('echo hello', '/tmp', { quiet: true });

      expect(code).toBe(0);
      expect(mockedExecSync).toHaveBeenCalledWith('echo hello', {
        stdio: 'pipe',
        cwd: '/tmp',
      });
    });

    it('does not write any output on success', () => {
      mockedExecSync.mockReturnValue(Buffer.from('some output'));

      runCommand('echo hello', undefined, { quiet: true });

      expect(stderrWriteSpy).not.toHaveBeenCalled();
      expect(stdoutWriteSpy).not.toHaveBeenCalled();
    });

    it('writes captured stdout and stderr to process.stderr on failure', () => {
      const stdout = Buffer.from('lint errors\n');
      const stderr = Buffer.from('error details\n');
      const error = Object.assign(new Error('command failed'), { status: 1, stdout, stderr });
      mockedExecSync.mockImplementation(() => {
        throw error;
      });

      const code = runCommand('lint', undefined, { quiet: true });

      expect(code).toBe(1);
      expect(stderrWriteSpy).toHaveBeenCalledWith(stdout);
      expect(stderrWriteSpy).toHaveBeenCalledWith(stderr);
    });

    it('handles null stdout and stderr buffers on the error object', () => {
      const error = Object.assign(new Error('command failed'), { status: 1, stdout: null, stderr: null });
      mockedExecSync.mockImplementation(() => {
        throw error;
      });

      const code = runCommand('lint', undefined, { quiet: true });

      expect(code).toBe(1);
      expect(stderrWriteSpy).not.toHaveBeenCalled();
    });

    it('handles empty buffers on the error object', () => {
      const error = Object.assign(new Error('command failed'), {
        status: 1,
        stdout: Buffer.from(''),
        stderr: Buffer.from(''),
      });
      mockedExecSync.mockImplementation(() => {
        throw error;
      });

      const code = runCommand('lint', undefined, { quiet: true });

      expect(code).toBe(1);
      expect(stderrWriteSpy).not.toHaveBeenCalled();
    });
  });
});
