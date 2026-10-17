import path from 'node:path';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import { findStaleBuildOutput, readBuildOutputState } from '../check-cache-build-output.ts';
import { resolveBuildCachePath } from '../commands/build-output.ts';

describe('check-cache', () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({ 'node_modules/': '' }, { prefix: 'nmr-check-cache-' }));
  });

  describe(readBuildOutputState, () => {
    it('reports a digest for every package covered by nmr’s build', async () => {
      const { aDir, bDir } = scaffoldWorkspace(tree);
      writeBuildDigest(tree, aDir, 'digest-a');
      writeBuildDigest(tree, bDir, 'digest-b');

      await expect(readBuildOutputState(tree.dir, {})).resolves.toStrictEqual({
        missingPackages: [],
        digests: { 'packages/a': 'digest-a', 'packages/b': 'digest-b' },
      });
    });

    it('keeps two packages of the same directory name apart', async () => {
      // A workspace glob set yielding `apps/web` beside `packages/web` would collapse onto one key if the
      // basename identified a package, and the shadowed one's output would never be compared again.
      scaffoldCollidingWorkspace(tree);

      await expect(readBuildOutputState(tree.dir, {})).resolves.toStrictEqual({
        missingPackages: [],
        digests: { 'apps/web': 'digest-app', 'packages/web': 'digest-package' },
      });
    });

    it('names the package whose output went missing', async () => {
      // Build output is git-ignored, so the tree hash says nothing about it: Without this a cached `ci`
      // would report success for a repository that cannot run.
      const { aDir } = scaffoldWorkspace(tree);
      tree.rm(`${aDir}/dist`);

      await expect(readBuildOutputState(tree.dir, {})).resolves.toMatchObject({ missingPackages: ['packages/a'] });
    });

    it('leaves out a package that overrides build in its package.json', async () => {
      // Because an override emits somewhere this does not know about, demanding a `dist` would make the package
      // a permanent miss rather than a covered one.
      const { aDir } = scaffoldWorkspace(tree);
      tree.rm(`${aDir}/dist`);
      writePackageJson(tree, aDir, { build: 'tsup' });

      await expect(readBuildOutputState(tree.dir, {})).resolves.toMatchObject({ missingPackages: [] });
    });

    it('leaves out a package that overrides compile in its package.json', async () => {
      const { aDir } = scaffoldWorkspace(tree);
      tree.rm(`${aDir}/dist`);
      writePackageJson(tree, aDir, { compile: 'tsc' });

      await expect(readBuildOutputState(tree.dir, {})).resolves.toMatchObject({ missingPackages: [] });
    });

    it('leaves out every package when the repo redefines build in its config', async () => {
      const { aDir } = scaffoldWorkspace(tree);
      tree.rm(`${aDir}/dist`);

      await expect(readBuildOutputState(tree.dir, { workspaceScripts: { build: 'make' } })).resolves.toStrictEqual({
        missingPackages: [],
        digests: {},
      });
    });

    it('does not expect output from a package whose sources emit none', async () => {
      const { aDir } = scaffoldWorkspace(tree);
      tree.rm(`${aDir}/dist`);
      tree.rm(`${aDir}/src`);

      await expect(readBuildOutputState(tree.dir, {})).resolves.toMatchObject({ missingPackages: [] });
    });

    it('does not expect output from a package whose own config ignores every entry point', async () => {
      // The build compiles the entry set that the package's own options leave; reading a different set here
      // would demand output never emitted by the build, and one such package fails the whole repo's gate.
      const { aDir } = scaffoldWorkspace(tree);
      tree.rm(`${aDir}/dist`);
      writeWorkspaceConfig(tree, aDir, { build: { extraIgnorePatterns: ['**/*.ts'] } });

      await expect(readBuildOutputState(tree.dir, {})).resolves.toMatchObject({ missingPackages: [] });
    });
  });

  describe(findStaleBuildOutput, () => {
    it('finds nothing when both observations found the same output', () => {
      expect(findStaleBuildOutput({ a: 'one', b: 'two' }, { a: 'one', b: 'two' })).toBeUndefined();
    });

    it('names a package whose output was rebuilt from different sources', () => {
      expect(findStaleBuildOutput({ a: 'one', b: 'two' }, { a: 'one', b: 'other' })).toBe('b');
    });

    it('names a package that has appeared between the two observations', () => {
      expect(findStaleBuildOutput({ a: 'one' }, { a: 'one', b: 'two' })).toBe('b');
    });

    it('names a package that has disappeared between the two observations', () => {
      expect(findStaleBuildOutput({ a: 'one', b: 'two' }, { a: 'one' })).toBe('b');
    });
  });
});

// region | Helpers

/** Writes a workspace whose globs yield two packages sharing a directory name, each freshly built. */
function scaffoldCollidingWorkspace(tree: TempTree): void {
  tree.write('pnpm-workspace.yaml', 'packages:\n  - "apps/*"\n  - "packages/*"\n');

  for (const [packagePath, digest] of [
    ['apps/web', 'digest-app'],
    ['packages/web', 'digest-package'],
  ] as const) {
    scaffoldBuiltPackage(tree, packagePath, packagePath.replace('/', '-'));
    writeBuildDigest(tree, packagePath, digest);
  }
}

/** Writes a pnpm workspace containing two packages that look freshly built, and returns their paths in the tree. */
function scaffoldWorkspace(tree: TempTree): { aDir: string; bDir: string } {
  tree.write('pnpm-workspace.yaml', 'packages:\n  - "packages/*"\n');

  const aDir = 'packages/a';
  const bDir = 'packages/b';
  for (const [packagePath, name] of [
    [aDir, 'a'],
    [bDir, 'b'],
  ] as const) {
    scaffoldBuiltPackage(tree, packagePath, name);
  }

  return { aDir, bDir };
}

/** Writes the sources and emitted output of a package that a build has already covered. */
function scaffoldBuiltPackage(tree: TempTree, packagePath: string, name: string): void {
  tree.writeAll({
    [`${packagePath}/src/index.ts`]: 'export const value = 1;\n',
    [`${packagePath}/dist/esm/index.js`]: 'export const value = 1;\n',
  });
  writePackageJson(tree, packagePath, undefined, name);
}

/** Writes the digest that a build of the package at `packagePath` would have left behind. */
function writeBuildDigest(tree: TempTree, packagePath: string, digest: string): void {
  tree.write(resolveBuildCachePath(tree.resolve(packagePath)), digest);
}

/** Writes a package's own nmr config. */
function writeWorkspaceConfig(tree: TempTree, packagePath: string, config: Record<string, unknown>): void {
  tree.write(`${packagePath}/.config/nmr.config.ts`, `export default ${JSON.stringify(config)};\n`);
}

/** Writes a package manifest, optionally declaring scripts that override the built-in build. */
function writePackageJson(
  tree: TempTree,
  packagePath: string,
  scripts?: Record<string, string>,
  name = path.basename(packagePath),
): void {
  tree.writeJson(`${packagePath}/package.json`, { name, type: 'module', ...(scripts && { scripts }) });
}

// endregion | Helpers
