import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findMonorepoRoot, getWorkspacePackageDirs } from '../workspace.ts';

// The monorepo root is two levels up from packages/nmr
const MONOREPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const NMR_PACKAGE_DIR = path.resolve(MONOREPO_ROOT, 'packages', 'nmr');

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

  describe('exact-path patterns', () => {
    let tempRoot: string;

    beforeEach(() => {
      tempRoot = mkdtempSync(path.join(tmpdir(), 'nmr-workspace-test-'));
      mkdirSync(path.join(tempRoot, 'tools', 'cli'), { recursive: true });
      writeFileSync(path.join(tempRoot, 'tools', 'cli', 'package.json'), '{}');
    });

    afterEach(() => {
      rmSync(tempRoot, { recursive: true, force: true });
    });

    it('resolves exact-path workspace patterns', () => {
      writeFileSync(path.join(tempRoot, 'pnpm-workspace.yaml'), 'packages:\n  - tools/cli\n');
      const dirs = getWorkspacePackageDirs(tempRoot);
      expect(dirs).toStrictEqual([path.join(tempRoot, 'tools', 'cli')]);
    });

    it('ignores exact-path patterns where the directory has no package.json', () => {
      mkdirSync(path.join(tempRoot, 'tools', 'empty'), { recursive: true });
      writeFileSync(path.join(tempRoot, 'pnpm-workspace.yaml'), 'packages:\n  - tools/empty\n');
      const dirs = getWorkspacePackageDirs(tempRoot);
      expect(dirs).toStrictEqual([]);
    });
  });

  // Pattern semantics are covered against `resolvePackageDirs` directly; this asserts only that the
  // manifest's patterns reach it intact, exclusions included.
  describe('manifest patterns', () => {
    let tempRoot: string;

    beforeEach(() => {
      tempRoot = mkdtempSync(path.join(tmpdir(), 'nmr-workspace-test-'));
      for (const name of ['alpha', 'legacy']) {
        mkdirSync(path.join(tempRoot, 'packages', name), { recursive: true });
        writeFileSync(path.join(tempRoot, 'packages', name, 'package.json'), '{}');
      }
    });

    afterEach(() => {
      rmSync(tempRoot, { recursive: true, force: true });
    });

    it('honors an exclusion declared in the manifest', () => {
      writeFileSync(
        path.join(tempRoot, 'pnpm-workspace.yaml'),
        "packages:\n  - 'packages/*'\n  - '!packages/legacy'\n",
      );
      const dirs = getWorkspacePackageDirs(tempRoot);
      expect(dirs).toStrictEqual([path.join(tempRoot, 'packages', 'alpha')]);
    });

    // `yaml` resolves an unquoted `!packages/legacy` to an empty string, so the exclusion never reaches
    // nmr and both packages resolve. A `yaml` release yielding a non-string instead would fail the
    // all-strings check and empty the result for a workspace that has packages; this pins that seam.
    it('resolves every package when an exclusion is left unquoted', () => {
      writeFileSync(path.join(tempRoot, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n  - !packages/legacy\n');
      const dirs = getWorkspacePackageDirs(tempRoot);
      expect(dirs).toStrictEqual([path.join(tempRoot, 'packages', 'alpha'), path.join(tempRoot, 'packages', 'legacy')]);
    });
  });
});
