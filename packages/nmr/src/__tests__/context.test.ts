import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findContainingPackageDir } from '../context.ts';

// The monorepo root is two levels up from packages/nmr
const MONOREPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const NMR_PACKAGE_DIR = path.resolve(MONOREPO_ROOT, 'packages', 'nmr');

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

  describe('nested packages', () => {
    const NESTED_PACKAGE_DIR = path.join(NMR_PACKAGE_DIR, 'plugins', 'inner');
    // Sorted order, as `getWorkspacePackageDirs` returns it: the outer package precedes the inner one.
    const nestedWorkspaceDirs = [NMR_PACKAGE_DIR, NESTED_PACKAGE_DIR];

    it('returns the inner package when cwd is the inner package root', () => {
      expect(findContainingPackageDir(NESTED_PACKAGE_DIR, nestedWorkspaceDirs)).toBe(NESTED_PACKAGE_DIR);
    });

    it('returns the inner package when cwd is nested inside it', () => {
      const deeperDir = path.join(NESTED_PACKAGE_DIR, 'src');
      expect(findContainingPackageDir(deeperDir, nestedWorkspaceDirs)).toBe(NESTED_PACKAGE_DIR);
    });

    it('returns the outer package for a directory outside the inner package', () => {
      const outerDir = path.join(NMR_PACKAGE_DIR, 'src');
      expect(findContainingPackageDir(outerDir, nestedWorkspaceDirs)).toBe(NMR_PACKAGE_DIR);
    });
  });
});
