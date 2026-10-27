import { silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:child_process'), () => ({
  execFileSync: mockExecFileSync,
}));

import { publishPackage } from '../publish.ts';
import type { ResolvedTag } from '../resolveReleaseTags.ts';

describe(publishPackage, () => {
  beforeEach(() => {
    void silenceConsole(['info']);
  });

  afterEach(() => {
    mockExecFileSync.mockReset();
    vi.restoreAllMocks();
  });

  const singleTag: ResolvedTag = { tag: 'v1.0.0', kind: 'package', dir: '.', workspacePath: '.', isPublishable: true };

  it('runs npm publish from the correct directory', () => {
    publishPackage(singleTag, 'npm', { isDryRun: false, shouldGenerateProvenance: false });

    expect(mockExecFileSync).toHaveBeenCalledWith('npm', ['publish'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('runs pnpm publish from the correct directory with --no-git-checks always emitted', () => {
    const tag: ResolvedTag = {
      tag: 'core-v1.3.0',
      kind: 'package',
      dir: 'core',
      workspacePath: 'packages/core',
      isPublishable: true,
    };

    publishPackage(tag, 'pnpm', { isDryRun: false, shouldGenerateProvenance: false });

    expect(mockExecFileSync).toHaveBeenCalledWith('pnpm', ['publish', '--no-git-checks'], {
      cwd: 'packages/core',
      stdio: 'inherit',
    });
  });

  it('forwards --dry-run flag for npm', () => {
    publishPackage(singleTag, 'npm', { isDryRun: true, shouldGenerateProvenance: false });

    expect(mockExecFileSync).toHaveBeenCalledWith('npm', ['publish', '--dry-run'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('does not emit --no-git-checks for npm', () => {
    publishPackage(singleTag, 'npm', { isDryRun: false, shouldGenerateProvenance: false });

    expect(mockExecFileSync).toHaveBeenCalledWith('npm', ['publish'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('does not emit --no-git-checks for yarn', () => {
    publishPackage(singleTag, 'yarn', { isDryRun: false, shouldGenerateProvenance: false });

    expect(mockExecFileSync).toHaveBeenCalledWith('yarn', ['publish'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('runs yarn npm publish for yarn-berry', () => {
    publishPackage(singleTag, 'yarn-berry', { isDryRun: false, shouldGenerateProvenance: false });

    expect(mockExecFileSync).toHaveBeenCalledWith('yarn', ['npm', 'publish'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('forwards --dry-run for yarn-berry', () => {
    publishPackage(singleTag, 'yarn-berry', { isDryRun: true, shouldGenerateProvenance: false });

    expect(mockExecFileSync).toHaveBeenCalledWith('yarn', ['npm', 'publish', '--dry-run'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('does not emit --no-git-checks for yarn-berry', () => {
    publishPackage(singleTag, 'yarn-berry', { isDryRun: false, shouldGenerateProvenance: false });

    expect(mockExecFileSync).toHaveBeenCalledWith('yarn', ['npm', 'publish'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('forwards --dry-run alongside --no-git-checks for pnpm', () => {
    publishPackage(singleTag, 'pnpm', { isDryRun: true, shouldGenerateProvenance: false });

    expect(mockExecFileSync).toHaveBeenCalledWith('pnpm', ['publish', '--dry-run', '--no-git-checks'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('forwards --provenance for npm', () => {
    publishPackage(singleTag, 'npm', { isDryRun: false, shouldGenerateProvenance: true });

    expect(mockExecFileSync).toHaveBeenCalledWith('npm', ['publish', '--provenance'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('forwards --provenance for pnpm alongside --no-git-checks', () => {
    publishPackage(singleTag, 'pnpm', { isDryRun: false, shouldGenerateProvenance: true });

    expect(mockExecFileSync).toHaveBeenCalledWith('pnpm', ['publish', '--no-git-checks', '--provenance'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('forwards --provenance for yarn-berry', () => {
    publishPackage(singleTag, 'yarn-berry', { isDryRun: false, shouldGenerateProvenance: true });

    expect(mockExecFileSync).toHaveBeenCalledWith('yarn', ['npm', 'publish', '--provenance'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('does not forward --provenance for classic yarn', () => {
    publishPackage(singleTag, 'yarn', { isDryRun: false, shouldGenerateProvenance: true });

    expect(mockExecFileSync).toHaveBeenCalledWith('yarn', ['publish'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('forwards --dry-run, --no-git-checks, and --provenance in deterministic order for pnpm', () => {
    publishPackage(singleTag, 'pnpm', { isDryRun: true, shouldGenerateProvenance: true });

    expect(mockExecFileSync).toHaveBeenCalledWith('pnpm', ['publish', '--dry-run', '--no-git-checks', '--provenance'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('forwards --dry-run but suppresses --provenance for classic yarn', () => {
    publishPackage(singleTag, 'yarn', { isDryRun: true, shouldGenerateProvenance: true });

    expect(mockExecFileSync).toHaveBeenCalledWith('yarn', ['publish', '--dry-run'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });
});
