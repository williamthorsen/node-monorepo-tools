import path from 'node:path';

import type { TempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { makeFixture, silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { readCheckCacheEntry, writeCheckCacheEntry } from '../../check-cache.ts';
import { resolveBuildCachePath } from '../build-output.ts';
import { cleanPackage, runClean } from '../clean.ts';

const it = baseIt
  .extend(
    'tree',
    makeFixture(() => createTempTree({}, { prefix: 'nmr-clean-' })),
  )
  // `auto`, because no test names the silencer: it exists for its effect on the console.
  .extend(
    'silenced',
    { auto: true },
    makeFixture(() => silenceConsole(['info'])),
  );

describe(cleanPackage, () => {
  it('removes the build output', async ({ tree }) => {
    scaffoldBuiltPackage(tree, '.');

    await cleanPackage(tree.dir);

    expect(tree.exists('dist')).toBe(false);
  });

  it('removes the build cache, so the next build cannot skip on a stale digest', async ({ tree }) => {
    scaffoldBuiltPackage(tree, '.');

    await cleanPackage(tree.dir);

    expect(tree.exists(resolveCacheEntry(tree, '.'))).toBe(false);
  });

  it('leaves the sources intact', async ({ tree }) => {
    scaffoldBuiltPackage(tree, '.');

    await cleanPackage(tree.dir);

    expect(tree.exists('src/index.ts')).toBe(true);
    expect(tree.exists('package.json')).toBe(true);
  });

  it('is a no-op on a package that was never built', async ({ tree }) => {
    tree.writeAll({
      'node_modules/': '',
      'package.json': JSON.stringify({ name: 'fixture', type: 'module' }),
    });

    await expect(cleanPackage(tree.dir)).resolves.toBeUndefined();
  });
});

describe(runClean, () => {
  it('cleans every workspace package when run from the monorepo root', async ({ tree }) => {
    // One process cleans them all. Re-invoking a bin per package would die as soon as the sweep removed
    // the output that bin loads from, in a repo that builds nmr itself — leaving the rest uncleaned.
    const { a, b } = scaffoldWorkspace(tree);

    await runClean(tree.dir);

    expect(hasOutput(tree, a)).toBe(false);
    expect(hasOutput(tree, b)).toBe(false);
  });

  it('cleans only the containing package when run from inside one', async ({ tree }) => {
    const { a, b } = scaffoldWorkspace(tree);

    await runClean(tree.resolve(a));

    expect(hasOutput(tree, a)).toBe(false);
    expect(hasOutput(tree, b)).toBe(true);
  });

  it('cleans the current directory when it is not in a pnpm workspace', async ({ tree }) => {
    scaffoldBuiltPackage(tree, '.');

    await runClean(tree.dir);

    expect(hasOutput(tree, '.')).toBe(false);
  });

  it("runs a package's own clean override from the root instead of sweeping it", async ({ tree }) => {
    // The sweep stands in for a per-package delegation, so a package that overrides `clean` must still get
    // its own command: a package emitting outside `dist` would otherwise be silently under-cleaned.
    const { a, b } = scaffoldWorkspace(tree);
    tree.write(
      `${a}/package.json`,
      JSON.stringify({
        name: 'a',
        type: 'module',
        scripts: { clean: `node --eval "require('fs').writeFileSync('cleaned.txt', '1')"` },
      }),
    );

    await runClean(tree.dir);

    expect(tree.exists(`${a}/cleaned.txt`)).toBe(true);
    expect(hasOutput(tree, a)).toBe(true);
    expect(hasOutput(tree, b)).toBe(false);
  });

  it('fails loudly when a package’s clean override fails', async ({ tree }) => {
    const { a } = scaffoldWorkspace(tree);
    tree.write(`${a}/package.json`, JSON.stringify({ name: 'a', type: 'module', scripts: { clean: 'exit 3' } }));

    await expect(runClean(tree.dir)).rejects.toThrow(/exit code 3/);
  });

  it('cleans in-process even when devBin names the built-in clean', async ({ tree }) => {
    // `devBin` substitutes a dev binary on the spawn path only: the sweep is already running whichever build
    // devBin selected, and re-spawning the binary whose own output the sweep deletes is the failure the
    // single-process sweep exists to prevent. The substitute fails if spawned, so a clean sweep proves it was not.
    const { a, b } = scaffoldWorkspace(tree);
    scaffoldConfig(tree, { devBin: { 'nmr-clean': 'exit 7' } });

    await runClean(tree.dir);

    expect(hasOutput(tree, a)).toBe(false);
    expect(hasOutput(tree, b)).toBe(false);
  });

  it('clears every recorded check result when run from the monorepo root', async ({ tree }) => {
    scaffoldWorkspace(tree);
    await recordCheckResult(tree.dir, tree.dir, 'ci');

    await runClean(tree.dir);

    await expect(
      readCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'ci' }),
    ).resolves.toBeUndefined();
  });

  it('clears the whole table when run from inside one package', async ({ tree }) => {
    // `b` is the package the invocation never enters, so its entry is what proves the clearing is repo-wide.
    const { a, b } = scaffoldWorkspace(tree);
    await recordCheckResult(tree.dir, tree.resolve(a), 'check');
    await recordCheckResult(tree.dir, tree.resolve(b), 'check');

    await runClean(tree.resolve(a));

    await expect(
      readCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.resolve(b), command: 'check' }),
    ).resolves.toBeUndefined();
  });

  it('clears the recorded check results of a package standing outside a workspace', async ({ tree }) => {
    scaffoldBuiltPackage(tree, '.');
    await recordCheckResult(tree.dir, tree.dir, 'check');

    await runClean(tree.dir);

    await expect(
      readCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'check' }),
    ).resolves.toBeUndefined();
  });

  it('closes the sweep with the count of packages it cleaned', async ({ tree }) => {
    scaffoldWorkspace(tree);

    await runClean(tree.dir);

    expect(console.info).toHaveBeenCalledWith('\n🧹 Cleaned 2 packages.');
  });

  it('counts in the closing statement the packages it left to an empty clean override', async ({ tree }) => {
    const { a } = scaffoldWorkspace(tree);
    tree.write(`${a}/package.json`, JSON.stringify({ name: 'a', type: 'module', scripts: { clean: '' } }));

    await runClean(tree.dir);

    expect(console.info).toHaveBeenCalledWith('\n🧹 Cleaned 1 package, skipping 1 with an empty clean override.');
  });

  it('closes nothing when the clean is scoped to one package, whose own line is already the conclusion', async ({
    tree,
  }) => {
    const { a } = scaffoldWorkspace(tree);

    await runClean(tree.resolve(a));

    expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining('Cleaned'));
  });

  it('skips a package whose clean resolves to an empty command', async ({ tree }) => {
    // An empty script is the package.json convention for "skip this command", so the sweep must leave the
    // output of a package that opted out of cleaning intact.
    const { a, b } = scaffoldWorkspace(tree);
    tree.write(`${a}/package.json`, JSON.stringify({ name: 'a', type: 'module', scripts: { clean: '' } }));

    await runClean(tree.dir);

    expect(hasOutput(tree, a)).toBe(true);
    expect(hasOutput(tree, b)).toBe(false);
  });
});

/** Returns true if the `dist` directory exists. */
function hasOutput(tree: TempTree, packageEntry: string): boolean {
  return tree.exists(`${packageEntry}/dist`);
}

/** Records a check result, standing in for a green run at that scope. */
async function recordCheckResult(monorepoRoot: string, anchorDir: string, command: string): Promise<void> {
  await writeCheckCacheEntry({
    monorepoRoot,
    anchorDir,
    command,
    entry: {
      key: 'a-key',
      treeHash: 'a-tree-hash',
      headSha: 'a-head-sha',
      commandString: `nmr ${command}`,
      nmrVersion: '1.0.0',
      nodeVersion: 'v24.0.0',
      durationMs: 1_000,
      recordedAt: '2026-08-02T12:00:00.000Z',
      buildDigests: {},
    },
  });
}

/** Resolves the package's build-cache entry, relative to the tree: the store returns the absolute path it keys. */
function resolveCacheEntry(tree: TempTree, packageEntry: string): string {
  return path.relative(tree.dir, resolveBuildCachePath(tree.resolve(packageEntry)));
}

/** Writes a package that looks freshly built: sources, emitted output, and a build-cache entry. */
function scaffoldBuiltPackage(tree: TempTree, packageEntry: string): void {
  tree.writeAll({
    [`${packageEntry}/dist/esm/index.js`]: 'export const value = 1;\n',
    [`${packageEntry}/node_modules/`]: '',
    [`${packageEntry}/package.json`]: JSON.stringify({ name: 'fixture', type: 'module' }),
    [`${packageEntry}/src/index.ts`]: 'export const value = 1;\n',
  });
  tree.write(resolveCacheEntry(tree, packageEntry), 'a-stale-digest');
}

/** Writes an nmr config at the workspace root. */
function scaffoldConfig(tree: TempTree, config: Record<string, unknown>): void {
  tree.write('.config/nmr.config.ts', `export default ${JSON.stringify(config)};\n`);
}

/** Writes a pnpm workspace root holding two built packages, and returns their tree-relative entries. */
function scaffoldWorkspace(tree: TempTree): { a: string; b: string } {
  tree.writeAll({
    'package.json': JSON.stringify({ name: 'root', type: 'module' }),
    'pnpm-workspace.yaml': 'packages:\n  - "packages/*"\n',
  });

  const a = 'packages/a';
  const b = 'packages/b';
  scaffoldBuiltPackage(tree, a);
  scaffoldBuiltPackage(tree, b);
  return { a, b };
}
