import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findContainingPackageDir, findMonorepoRoot, getWorkspacePackageDirs } from '../src/context.js';

// The monorepo root is two levels up from packages/nmr
const MONOREPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const NMR_PACKAGE_DIR = path.resolve(import.meta.dirname, '..');

describe('findMonorepoRoot', () => {
  it('finds root from the monorepo root', () => {
    expect(findMonorepoRoot(MONOREPO_ROOT)).toBe(MONOREPO_ROOT);
  });

  it('finds root from a package directory', () => {
    expect(findMonorepoRoot(NMR_PACKAGE_DIR)).toBe(MONOREPO_ROOT);
  });

  it('finds root from a nested directory within a package', () => {
    const nestedDir = path.join(NMR_PACKAGE_DIR, 'src');
    expect(findMonorepoRoot(nestedDir)).toBe(MONOREPO_ROOT);
  });

  it('throws when no pnpm-workspace.yaml is found', () => {
    expect(() => findMonorepoRoot('/')).toThrow(
      'Could not find monorepo root: no pnpm-workspace.yaml found in any parent directory',
    );
  });
});

describe('getWorkspacePackageDirs', () => {
  it('returns directories matching workspace patterns', () => {
    const dirs = getWorkspacePackageDirs(MONOREPO_ROOT);
    expect(dirs).toContainEqual(NMR_PACKAGE_DIR);
  });

  it('only returns directories with package.json', () => {
    const dirs = getWorkspacePackageDirs(MONOREPO_ROOT);
    for (const dir of dirs) {
      expect(dir).toMatch(/packages\//);
    }
  });
});

describe('findContainingPackageDir', () => {
  const workspaceDirs = [NMR_PACKAGE_DIR];

  it('returns the package dir when cwd is the package root', () => {
    expect(findContainingPackageDir(NMR_PACKAGE_DIR, workspaceDirs)).toBe(NMR_PACKAGE_DIR);
  });

  it('returns the package dir when cwd is nested inside a package', () => {
    const nestedDir = path.join(NMR_PACKAGE_DIR, 'src', 'commands');
    expect(findContainingPackageDir(nestedDir, workspaceDirs)).toBe(NMR_PACKAGE_DIR);
  });

  it('returns undefined when cwd is the monorepo root', () => {
    expect(findContainingPackageDir(MONOREPO_ROOT, workspaceDirs)).toBeUndefined();
  });

  it('returns undefined for non-workspace subdirectories', () => {
    const scriptsDir = path.join(MONOREPO_ROOT, 'scripts');
    expect(findContainingPackageDir(scriptsDir, workspaceDirs)).toBeUndefined();
  });

  it('returns undefined for the config directory', () => {
    const configDir = path.join(MONOREPO_ROOT, 'config');
    expect(findContainingPackageDir(configDir, workspaceDirs)).toBeUndefined();
  });
});
