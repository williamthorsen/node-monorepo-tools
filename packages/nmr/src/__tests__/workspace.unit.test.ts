import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import {
  diagnoseEmptyWorkspace,
  findMonorepoRoot,
  getWorkspacePackageDirs,
  readWorkspacePackageNames,
} from '../workspace.ts';

// The monorepo root is two levels up from packages/nmr
const MONOREPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const NMR_PACKAGE_DIR = path.resolve(MONOREPO_ROOT, 'packages', 'nmr');

const PREFIX = 'nmr-workspace-test-';

const it = baseIt
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
      toolsTree.write('pnpm-workspace.yaml', 'packages:\n  - tools/cli\n');
      const dirs = getWorkspacePackageDirs(toolsTree.dir);
      expect(dirs).toStrictEqual([path.join(toolsTree.dir, 'tools', 'cli')]);
    });

    it('ignores exact-path patterns where the directory has no package.json', ({ toolsTree }) => {
      toolsTree.mkdir('tools/empty');
      toolsTree.write('pnpm-workspace.yaml', 'packages:\n  - tools/empty\n');
      const dirs = getWorkspacePackageDirs(toolsTree.dir);
      expect(dirs).toStrictEqual([]);
    });
  });

  // Pattern semantics are covered against `resolvePackageDirs` directly; this asserts only that the
  // manifest's patterns reach it intact, exclusions included.
  describe('manifest patterns', () => {
    it('honors an exclusion declared in the manifest', ({ packagesTree }) => {
      packagesTree.write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - '!packages/legacy'\n");
      const dirs = getWorkspacePackageDirs(packagesTree.dir);
      expect(dirs).toStrictEqual([path.join(packagesTree.dir, 'packages', 'alpha')]);
    });

    // `yaml` resolves an unquoted `!packages/legacy` to an empty string, so the exclusion never reaches
    // nmr and both packages resolve. A `yaml` release yielding a non-string instead would fail the
    // all-strings check and empty the result for a workspace that has packages; this pins that seam.
    it('resolves every package when an exclusion is left unquoted', ({ packagesTree }) => {
      packagesTree.write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n  - !packages/legacy\n');
      const dirs = getWorkspacePackageDirs(packagesTree.dir);
      expect(dirs).toStrictEqual([
        path.join(packagesTree.dir, 'packages', 'alpha'),
        path.join(packagesTree.dir, 'packages', 'legacy'),
      ]);
    });
  });
});

describe(diagnoseEmptyWorkspace, () => {
  it.for([
    { patterns: undefined, scenario: 'no `packages` key' },
    { patterns: '[]', scenario: 'an empty list' },
    { patterns: "'packages/*'", scenario: 'a list holding something other than strings' },
    { patterns: "\n  - '!packages/legacy'", scenario: 'exclusions alone' },
  ])('reports no-pattern given $scenario', ({ patterns }, { packagesTree }) => {
    packagesTree.write(
      'pnpm-workspace.yaml',
      patterns === undefined ? 'shamefully-hoist: true\n' : `packages: ${patterns}\n`,
    );

    expect(diagnoseEmptyWorkspace(packagesTree.dir).cause).toBe('no-pattern');
  });

  it('reports no-manifest where the pattern matches no directory holding one', ({ toolsTree }) => {
    toolsTree.mkdir('tools/empty');
    toolsTree.write('pnpm-workspace.yaml', "packages:\n  - 'tools/empty'\n");

    expect(diagnoseEmptyWorkspace(toolsTree.dir)).toStrictEqual({ cause: 'no-manifest', patterns: ['tools/empty'] });
  });

  it('reports all-excluded where the exclusions remove every match', ({ packagesTree }) => {
    packagesTree.write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - '!packages/*'\n");

    expect(diagnoseEmptyWorkspace(packagesTree.dir)).toStrictEqual({
      cause: 'all-excluded',
      patterns: ['packages/*', '!packages/*'],
    });
  });

  // An exclusion that removes some but not all of the matches leaves the workspace non-empty, so the only
  // exclusion-bearing manifest reaching the diagnosis with no positive match is one whose patterns matched none.
  it('reports no-manifest where exclusions are declared but the positive patterns matched nothing', ({ toolsTree }) => {
    toolsTree.write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - '!packages/legacy'\n");

    expect(diagnoseEmptyWorkspace(toolsTree.dir).cause).toBe('no-manifest');
  });

  it('carries the declared patterns, which a message quotes back', ({ packagesTree }) => {
    packagesTree.write('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n");

    expect(diagnoseEmptyWorkspace(packagesTree.dir).patterns).toStrictEqual(['apps/*']);
  });

  it('throws a message naming the directory when it holds no manifest', () => {
    using notARoot = createTempTree({}, { prefix: PREFIX });

    expect(() => diagnoseEmptyWorkspace(notARoot.dir)).toThrow(
      `Not a monorepo root: no pnpm-workspace.yaml in ${notARoot.dir}`,
    );
  });
});

describe(readWorkspacePackageNames, () => {
  it('reads the name each manifest declares', ({ packagesTree }) => {
    packagesTree.write('packages/alpha/package.json', '{"name":"@scope/alpha"}');
    packagesTree.write('packages/legacy/package.json', '{"name":"legacy"}');

    const names = readWorkspacePackageNames([
      path.join(packagesTree.dir, 'packages', 'alpha'),
      path.join(packagesTree.dir, 'packages', 'legacy'),
    ]);

    expect(names).toStrictEqual(['@scope/alpha', 'legacy']);
  });

  // The names serve a diagnostic, so a manifest that cannot be read costs its own name and no more.
  it('passes over a manifest that is missing, unparseable, or nameless', ({ packagesTree }) => {
    packagesTree.write('packages/alpha/package.json', '{"name":"@scope/alpha"}');
    packagesTree.write('packages/legacy/package.json', '{ oops');

    const names = readWorkspacePackageNames([
      path.join(packagesTree.dir, 'packages', 'alpha'),
      path.join(packagesTree.dir, 'packages', 'legacy'),
      path.join(packagesTree.dir, 'packages', 'nameless'),
    ]);

    expect(names).toStrictEqual(['@scope/alpha']);
  });
});
