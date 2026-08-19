import fs from 'node:fs';
import path from 'node:path';

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
    scaffoldBuiltPackage(tree.dir);

    await cleanPackage(tree.dir);

    expect(fs.existsSync(path.join(tree.dir, 'dist'))).toBe(false);
  });

  it('removes the build cache, so the next build cannot skip on a stale digest', async ({ tree }) => {
    scaffoldBuiltPackage(tree.dir);

    await cleanPackage(tree.dir);

    expect(fs.existsSync(resolveBuildCachePath(tree.dir))).toBe(false);
  });

  it('leaves the sources intact', async ({ tree }) => {
    scaffoldBuiltPackage(tree.dir);

    await cleanPackage(tree.dir);

    expect(fs.existsSync(path.join(tree.dir, 'src', 'index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tree.dir, 'package.json'))).toBe(true);
  });

  it('is a no-op on a package that was never built', async ({ tree }) => {
    fs.mkdirSync(path.join(tree.dir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(tree.dir, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module' }));

    await expect(cleanPackage(tree.dir)).resolves.toBeUndefined();
  });
});

describe(runClean, () => {
  it('cleans every workspace package when run from the monorepo root', async ({ tree }) => {
    // One process cleans them all. Re-invoking a bin per package would die as soon as the sweep removed
    // the output that bin loads from, in a repo that builds nmr itself — leaving the rest uncleaned.
    const { a, b } = scaffoldWorkspace(tree.dir);

    await runClean(tree.dir);

    expect(hasOutput(a)).toBe(false);
    expect(hasOutput(b)).toBe(false);
  });

  it('cleans only the containing package when run from inside one', async ({ tree }) => {
    const { a, b } = scaffoldWorkspace(tree.dir);

    await runClean(a);

    expect(hasOutput(a)).toBe(false);
    expect(hasOutput(b)).toBe(true);
  });

  it('cleans the current directory when it is not in a pnpm workspace', async ({ tree }) => {
    scaffoldBuiltPackage(tree.dir);

    await runClean(tree.dir);

    expect(hasOutput(tree.dir)).toBe(false);
  });

  it("runs a package's own clean override from the root instead of sweeping it", async ({ tree }) => {
    // The sweep stands in for a per-package delegation, so a package that overrides `clean` must still get
    // its own command: a package emitting outside `dist` would otherwise be silently under-cleaned.
    const { a, b } = scaffoldWorkspace(tree.dir);
    fs.writeFileSync(
      path.join(a, 'package.json'),
      JSON.stringify({
        name: 'a',
        type: 'module',
        scripts: { clean: `node --eval "require('fs').writeFileSync('cleaned.txt', '1')"` },
      }),
    );

    await runClean(tree.dir);

    expect(fs.existsSync(path.join(a, 'cleaned.txt'))).toBe(true);
    expect(hasOutput(a)).toBe(true);
    expect(hasOutput(b)).toBe(false);
  });

  it('fails loudly when a package’s clean override fails', async ({ tree }) => {
    const { a } = scaffoldWorkspace(tree.dir);
    fs.writeFileSync(
      path.join(a, 'package.json'),
      JSON.stringify({ name: 'a', type: 'module', scripts: { clean: 'exit 3' } }),
    );

    await expect(runClean(tree.dir)).rejects.toThrow(/exit code 3/);
  });

  it('cleans in-process even when devBin names the built-in clean', async ({ tree }) => {
    // `devBin` substitutes a dev binary on the spawn path only: the sweep is already running whichever build
    // devBin selected, and re-spawning the binary whose own output the sweep deletes is the failure the
    // single-process sweep exists to prevent. The substitute fails if spawned, so a clean sweep proves it was not.
    const { a, b } = scaffoldWorkspace(tree.dir);
    scaffoldConfig(tree.dir, { devBin: { 'nmr-clean': 'exit 7' } });

    await runClean(tree.dir);

    expect(hasOutput(a)).toBe(false);
    expect(hasOutput(b)).toBe(false);
  });

  it('clears every recorded check result when run from the monorepo root', async ({ tree }) => {
    scaffoldWorkspace(tree.dir);
    await recordCheckResult(tree.dir, tree.dir, 'ci');

    await runClean(tree.dir);

    await expect(
      readCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'ci' }),
    ).resolves.toBeUndefined();
  });

  it('clears the whole table when run from inside one package', async ({ tree }) => {
    // `b` is the package the invocation never enters, so its entry is what proves the clearing is repo-wide.
    const { a, b } = scaffoldWorkspace(tree.dir);
    await recordCheckResult(tree.dir, a, 'check');
    await recordCheckResult(tree.dir, b, 'check');

    await runClean(a);

    await expect(
      readCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: b, command: 'check' }),
    ).resolves.toBeUndefined();
  });

  it('clears the recorded check results of a package standing outside a workspace', async ({ tree }) => {
    scaffoldBuiltPackage(tree.dir);
    await recordCheckResult(tree.dir, tree.dir, 'check');

    await runClean(tree.dir);

    await expect(
      readCheckCacheEntry({ monorepoRoot: tree.dir, anchorDir: tree.dir, command: 'check' }),
    ).resolves.toBeUndefined();
  });

  it('closes the sweep with the count of packages it cleaned', async ({ tree }) => {
    scaffoldWorkspace(tree.dir);

    await runClean(tree.dir);

    expect(console.info).toHaveBeenCalledWith('\n🧹 Cleaned 2 packages.');
  });

  it('counts in the closing statement the packages it left to an empty clean override', async ({ tree }) => {
    const { a } = scaffoldWorkspace(tree.dir);
    fs.writeFileSync(
      path.join(a, 'package.json'),
      JSON.stringify({ name: 'a', type: 'module', scripts: { clean: '' } }),
    );

    await runClean(tree.dir);

    expect(console.info).toHaveBeenCalledWith('\n🧹 Cleaned 1 package, skipping 1 with an empty clean override.');
  });

  it('closes nothing when the clean is scoped to one package, whose own line is already the conclusion', async ({
    tree,
  }) => {
    const { a } = scaffoldWorkspace(tree.dir);

    await runClean(a);

    expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining('Cleaned'));
  });

  it('skips a package whose clean resolves to an empty command', async ({ tree }) => {
    // An empty script is the package.json convention for "skip this command", so the sweep must leave the
    // output of a package that opted out of cleaning intact.
    const { a, b } = scaffoldWorkspace(tree.dir);
    fs.writeFileSync(
      path.join(a, 'package.json'),
      JSON.stringify({ name: 'a', type: 'module', scripts: { clean: '' } }),
    );

    await runClean(tree.dir);

    expect(hasOutput(a)).toBe(true);
    expect(hasOutput(b)).toBe(false);
  });
});

/** Returns true if the `dist` directory exists. */
function hasOutput(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'dist'));
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

/** Writes a package that looks freshly built: sources, emitted output, and a build-cache entry. */
function scaffoldBuiltPackage(dir: string): void {
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'dist', 'esm'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module' }));
  fs.writeFileSync(path.join(dir, 'src', 'index.ts'), 'export const value = 1;\n');
  fs.writeFileSync(path.join(dir, 'dist', 'esm', 'index.js'), 'export const value = 1;\n');

  const cachePath = resolveBuildCachePath(dir);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, 'a-stale-digest');
}

/** Writes an nmr config at the workspace root. */
function scaffoldConfig(root: string, config: Record<string, unknown>): void {
  fs.mkdirSync(path.join(root, '.config'), { recursive: true });
  fs.writeFileSync(path.join(root, '.config', 'nmr.config.ts'), `export default ${JSON.stringify(config)};\n`);
}

/** Writes a pnpm workspace root holding two built packages, and returns their directories. */
function scaffoldWorkspace(root: string): { a: string; b: string } {
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'root', type: 'module' }));

  const a = path.join(root, 'packages', 'a');
  const b = path.join(root, 'packages', 'b');
  fs.mkdirSync(a, { recursive: true });
  fs.mkdirSync(b, { recursive: true });
  scaffoldBuiltPackage(a);
  scaffoldBuiltPackage(b);
  return { a, b };
}
