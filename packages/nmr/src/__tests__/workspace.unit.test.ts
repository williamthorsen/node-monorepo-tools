import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { UserError } from '../UserError.ts';
import {
  findMonorepoRoot,
  getWorkspacePackageDirs,
  isMonorepoRoot,
  readWorkspaceOverrides,
  readWorkspacePackageNames,
  resolveWorkspace,
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

  // The projection is what gives nmr-core's total primitive nmr's own error boundary.
  it('throws a UserError, which the CLI reports rather than reporting as a crash', () => {
    expect(() => findMonorepoRoot('/')).toThrow(UserError);
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
    using notARoot = createTempTree({}, { prefix: PREFIX });

    expect(() => getWorkspacePackageDirs(notARoot.dir)).toThrow(
      `Not a monorepo root: no pnpm-workspace.yaml in ${notARoot.dir}`,
    );
  });

  it('throws a UserError, which the CLI reports rather than reporting as a crash', () => {
    using notARoot = createTempTree({}, { prefix: PREFIX });

    expect(() => getWorkspacePackageDirs(notARoot.dir)).toThrow(UserError);
  });

  // The empty resolution is the one case the projection flattens rather than throwing on: a workspace that
  // declares patterns and matches nothing is a workspace whose package list is empty.
  it('returns nothing when the manifest declares patterns that match no package', ({ toolsTree }) => {
    toolsTree.write('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n");

    expect(getWorkspacePackageDirs(toolsTree.dir)).toStrictEqual([]);
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

  // Pattern semantics are covered against nmr-core's resolver directly; this asserts only that the manifest's
  // patterns reach it intact, exclusions included.
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

// The primitives are covered in nmr-core; these assert that `@williamthorsen/nmr/workspace` still publishes
// them, which its consumers reach them through.
describe('the re-exported primitives', () => {
  it('resolves a workspace through `resolveWorkspace`', ({ toolsTree }) => {
    toolsTree.write('pnpm-workspace.yaml', 'packages:\n  - tools/cli\n');

    expect(resolveWorkspace(toolsTree.dir)).toStrictEqual({
      kind: 'packages',
      packageDirs: [path.join(toolsTree.dir, 'tools', 'cli')],
      patterns: ['tools/cli'],
    });
  });

  it('reports a monorepo root through `isMonorepoRoot`', ({ toolsTree }) => {
    expect(isMonorepoRoot(MONOREPO_ROOT)).toBe(true);
    expect(isMonorepoRoot(toolsTree.dir)).toBe(false);
  });

  it('reads overrides through `readWorkspaceOverrides`', ({ toolsTree }) => {
    toolsTree.write('pnpm-workspace.yaml', "overrides:\n  semver: '7.8.5'\n");

    expect(readWorkspaceOverrides(toolsTree.dir)).toStrictEqual({ semver: '7.8.5' });
  });

  it('reads package names through `readWorkspacePackageNames`', ({ packagesTree }) => {
    packagesTree.write('packages/alpha/package.json', '{"name":"@scope/alpha"}');

    expect(readWorkspacePackageNames([path.join(packagesTree.dir, 'packages', 'alpha')])).toStrictEqual([
      '@scope/alpha',
    ]);
  });
});
