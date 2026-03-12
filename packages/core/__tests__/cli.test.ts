import { execSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const MONOREPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const CORE_PACKAGE_DIR = path.resolve(MONOREPO_ROOT, 'packages', 'core');
const CLI_PATH = path.join(CORE_PACKAGE_DIR, 'dist', 'esm', 'cli.js');

function runNmr(args: string, options: { cwd?: string } = {}): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args}`, {
      cwd: options.cwd ?? MONOREPO_ROOT,
      encoding: 'utf8',
      timeout: 10_000,
    });
    return { stdout, exitCode: 0 };
  } catch (error) {
    const err = error as { stdout?: string; status?: number };
    return {
      stdout: (err.stdout ?? '') as string,
      exitCode: err.status ?? 1,
    };
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
});
