import path from 'node:path';

import { UserError } from '@williamthorsen/nmr-core';
import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it } from 'vitest';

import { findContainingPackageDir, resolveContext } from '../context.ts';

// The monorepo root is two levels up from packages/nmr
const MONOREPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const NMR_PACKAGE_DIR = path.resolve(MONOREPO_ROOT, 'packages', 'nmr');

describe(findContainingPackageDir, () => {
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

describe(resolveContext, () => {
  const treeIt = it.extend(
    'plainTree',
    makeFixture(() => createTempTree({ 'src/a.js': '' }, { prefix: 'nmr-context-test-' })),
  );

  it('resolves a workspace root as it did before, with hasWorkspace set', async () => {
    const findGitToplevel = () => ({ ok: false as const, error: 'not consulted' });
    const context = await resolveContext(NMR_PACKAGE_DIR, { findGitToplevel });

    expect(context).toMatchObject({
      monorepoRoot: MONOREPO_ROOT,
      hasWorkspace: true,
      isRoot: false,
      packageDir: NMR_PACKAGE_DIR,
    });
    expect(context.workspacePackageDirs).toContain(NMR_PACKAGE_DIR);
  });

  treeIt('falls back to the git toplevel when no pnpm-workspace.yaml is found', async ({ plainTree }) => {
    const findGitToplevel = () => ({ ok: true as const, stdout: `${plainTree.dir}\n` });
    const context = await resolveContext(path.join(plainTree.dir, 'src'), { findGitToplevel });

    expect(context).toStrictEqual({
      monorepoRoot: plainTree.dir,
      hasWorkspace: false,
      isRoot: true,
      workspacePackageDirs: [],
      config: {},
    });
  });

  treeIt('names both missing roots when git does not find a repository either', async ({ plainTree }) => {
    const findGitToplevel = () => ({ ok: false as const, error: 'fatal: not a git repository\n' });
    const promise = resolveContext(plainTree.dir, { findGitToplevel });

    await expect(promise).rejects.toThrow(UserError);
    await expect(promise).rejects.toThrow(
      `nmr needs a pnpm workspace or a git repository: no pnpm-workspace.yaml in ${plainTree.dir} or any parent ` +
        `directory, and ${plainTree.dir} is not inside a git repository (fatal: not a git repository).`,
    );
  });
});
