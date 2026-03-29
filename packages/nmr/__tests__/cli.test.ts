import { execSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const MONOREPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const NMR_PACKAGE_DIR = path.resolve(MONOREPO_ROOT, 'packages', 'nmr');
const CLI_PATH = path.join(NMR_PACKAGE_DIR, 'dist', 'esm', 'cli.js');

function runNmr(
  args: string,
  options: { cwd?: string; env?: Record<string, string> } = {},
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args}`, {
      cwd: options.cwd ?? MONOREPO_ROOT,
      env: { ...process.env, ...options.env },
      encoding: 'utf8',
      timeout: 10_000,
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error: unknown) {
    const stdout =
      error !== null && typeof error === 'object' && 'stdout' in error && typeof error.stdout === 'string'
        ? error.stdout
        : '';
    const stderr =
      error !== null && typeof error === 'object' && 'stderr' in error && typeof error.stderr === 'string'
        ? error.stderr
        : '';
    const exitCode =
      error !== null && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
        ? error.status
        : 1;
    return { stdout, stderr, exitCode };
  }
}

describe('nmr CLI', () => {
  it('shows help with --help flag', () => {
    const { stdout, exitCode } = runNmr('--help');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage: nmr');
    expect(stdout).toContain('Workspace commands:');
    expect(stdout).toContain('Root commands:');
  });

  it('shows help with -? flag', () => {
    const { stdout, exitCode } = runNmr('-?');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage: nmr');
  });

  it('shows help when no command is given', () => {
    const { stdout, exitCode } = runNmr('');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage: nmr');
  });

  it('exits with error for unknown command', () => {
    const { exitCode } = runNmr('nonexistent-command');
    expect(exitCode).toBe(1);
  });

  it('resolves root package.json scripts at monorepo root', () => {
    const { exitCode } = runNmr('postinstall');
    expect(exitCode).toBe(0);
  });

  it('does not log override message for package.json scripts not in registry', () => {
    const { stdout, exitCode } = runNmr('postinstall');
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain('Using override script');
  });

  describe('NMR_RUN_IF_PRESENT', () => {
    it('exits 0 for unknown command when set', () => {
      const { exitCode, stderr } = runNmr('nonexistent-command', {
        env: { NMR_RUN_IF_PRESENT: '1' },
      });
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
    });

    it('still exits 1 for unknown command when not set', () => {
      const { exitCode } = runNmr('nonexistent-command');
      expect(exitCode).toBe(1);
    });
  });

  describe('--quiet flag', () => {
    it('accepts -q flag without parse errors', () => {
      const { stdout, exitCode } = runNmr('-q --help');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Usage: nmr');
    });

    it('accepts --quiet flag without parse errors', () => {
      const { stdout, exitCode } = runNmr('--quiet --help');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Usage: nmr');
    });

    it('shows -q, --quiet in help output', () => {
      const { stdout } = runNmr('--help');
      expect(stdout).toContain('-q, --quiet');
    });

    it('suppresses output on successful command in quiet mode', () => {
      const { stdout, stderr, exitCode } = runNmr('-q typecheck', { cwd: NMR_PACKAGE_DIR });
      expect(exitCode).toBe(0);
      expect(stdout).toBe('');
      expect(stderr).toBe('');
    });

    it('still exits with error for unknown command when quiet', () => {
      const { stderr, exitCode } = runNmr('--quiet nonexistent-command');
      expect(exitCode).toBe(1);
      expect(stderr).toContain('Unknown command');
    });
  });
});
