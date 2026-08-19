import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, test } from 'vitest';

import { findMonorepoRoot, getWorkspacePackageDirs } from '../workspace.ts';

// The monorepo root is two levels up from packages/nmr
const MONOREPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const NMR_PACKAGE_DIR = path.resolve(MONOREPO_ROOT, 'packages', 'nmr');

const PREFIX = 'nmr-workspace-test-';

const it = test
  .extend(
    'toolsTree',
    makeFixture(() => createTempTree({ 'tools/cli/package.json': '{}' }, { prefix: PREFIX })),
  )
  .extend(
    'packagesTree',
    makeFixture(() =>
      createTempTree({ 'packages/alpha/package.json': '{}', 'packages/legacy/package.json': '{}' }, { prefix: PREFIX }),
    ),
  );

describe(findMonorepoRoot, () => {
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

describe(getWorkspacePackageDirs, () => {
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

  it('throws a message naming the directory when it holds no manifest', () => {
    using notARoot = createTempTree({}, { prefix: 'nmr-workspace-test-' });

    expect(() => getWorkspacePackageDirs(notARoot.dir)).toThrow(
      `Not a monorepo root: no pnpm-workspace.yaml in ${notARoot.dir}`,
    );
  });

  describe('exact-path patterns', () => {
    it('resolves exact-path workspace patterns', ({ toolsTree }) => {
      writeFileSync(path.join(toolsTree.dir, 'pnpm-workspace.yaml'), 'packages:\n  - tools/cli\n');
      const dirs = getWorkspacePackageDirs(toolsTree.dir);
      expect(dirs).toStrictEqual([path.join(toolsTree.dir, 'tools', 'cli')]);
    });

    it('ignores exact-path patterns where the directory has no package.json', ({ toolsTree }) => {
      mkdirSync(path.join(toolsTree.dir, 'tools', 'empty'), { recursive: true });
      writeFileSync(path.join(toolsTree.dir, 'pnpm-workspace.yaml'), 'packages:\n  - tools/empty\n');
      const dirs = getWorkspacePackageDirs(toolsTree.dir);
      expect(dirs).toStrictEqual([]);
    });
  });

  // Pattern semantics are covered against `resolvePackageDirs` directly; this asserts only that the
  // manifest's patterns reach it intact, exclusions included.
  describe('manifest patterns', () => {
    it('honors an exclusion declared in the manifest', ({ packagesTree }) => {
      writeFileSync(
        path.join(packagesTree.dir, 'pnpm-workspace.yaml'),
        "packages:\n  - 'packages/*'\n  - '!packages/legacy'\n",
      );
      const dirs = getWorkspacePackageDirs(packagesTree.dir);
      expect(dirs).toStrictEqual([path.join(packagesTree.dir, 'packages', 'alpha')]);
    });

    // `yaml` resolves an unquoted `!packages/legacy` to an empty string, so the exclusion never reaches
    // nmr and both packages resolve. A `yaml` release yielding a non-string instead would fail the
    // all-strings check and empty the result for a workspace that has packages; this pins that seam.
    it('resolves every package when an exclusion is left unquoted', ({ packagesTree }) => {
      writeFileSync(
        path.join(packagesTree.dir, 'pnpm-workspace.yaml'),
        'packages:\n  - packages/*\n  - !packages/legacy\n',
      );
      const dirs = getWorkspacePackageDirs(packagesTree.dir);
      expect(dirs).toStrictEqual([
        path.join(packagesTree.dir, 'packages', 'alpha'),
        path.join(packagesTree.dir, 'packages', 'legacy'),
      ]);
    });
  });
});
