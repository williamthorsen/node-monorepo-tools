import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveBuildCachePath } from '../build.ts';
import { cleanPackage, runClean } from '../clean.ts';

describe(cleanPackage, () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-clean-'));
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.mocked(console.info).mockRestore();
  });

  it('removes the build output', async () => {
    scaffoldBuiltPackage(dir);

    await cleanPackage(dir);

    expect(fs.existsSync(path.join(dir, 'dist'))).toBe(false);
  });

  it('removes the build cache, so the next build cannot skip on a stale digest', async () => {
    scaffoldBuiltPackage(dir);

    await cleanPackage(dir);

    expect(fs.existsSync(resolveBuildCachePath(dir))).toBe(false);
  });

  it('leaves the sources intact', async () => {
    scaffoldBuiltPackage(dir);

    await cleanPackage(dir);

    expect(fs.existsSync(path.join(dir, 'src', 'index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'package.json'))).toBe(true);
  });

  it('is a no-op on a package that was never built', async () => {
    fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module' }));

    await expect(cleanPackage(dir)).resolves.toBeUndefined();
  });
});

describe(runClean, () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-clean-workspace-'));
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    vi.mocked(console.info).mockRestore();
  });

  it('cleans every workspace package when run from the monorepo root', async () => {
    // One process cleans them all. Re-invoking a bin per package would die as soon as the sweep removed
    // the output that bin loads from, in a repo that builds nmr itself — leaving the rest uncleaned.
    const { a, b } = scaffoldWorkspace(root);

    await runClean(root);

    expect(hasOutput(a)).toBe(false);
    expect(hasOutput(b)).toBe(false);
  });

  it('cleans only the containing package when run from inside one', async () => {
    const { a, b } = scaffoldWorkspace(root);

    await runClean(a);

    expect(hasOutput(a)).toBe(false);
    expect(hasOutput(b)).toBe(true);
  });

  it('cleans the current directory when it is not in a pnpm workspace', async () => {
    scaffoldBuiltPackage(root);

    await runClean(root);

    expect(hasOutput(root)).toBe(false);
  });

  it("runs a package's own clean override from the root instead of sweeping it", async () => {
    // The sweep stands in for a per-package delegation, so a package that overrides `clean` must still get
    // its own command: a package emitting outside `dist` would otherwise be silently under-cleaned.
    const { a, b } = scaffoldWorkspace(root);
    fs.writeFileSync(
      path.join(a, 'package.json'),
      JSON.stringify({
        name: 'a',
        type: 'module',
        scripts: { clean: `node --eval "require('fs').writeFileSync('cleaned.txt', '1')"` },
      }),
    );

    await runClean(root);

    expect(fs.existsSync(path.join(a, 'cleaned.txt'))).toBe(true);
    expect(hasOutput(a)).toBe(true);
    expect(hasOutput(b)).toBe(false);
  });

  it('fails loudly when a package’s clean override fails', async () => {
    const { a } = scaffoldWorkspace(root);
    fs.writeFileSync(
      path.join(a, 'package.json'),
      JSON.stringify({ name: 'a', type: 'module', scripts: { clean: 'exit 3' } }),
    );

    await expect(runClean(root)).rejects.toThrow(/exit code 3/);
  });

  it('cleans in-process even when devBin names the built-in clean', async () => {
    // `devBin` substitutes a dev binary on the spawn path only: the sweep is already running whichever build
    // devBin selected, and re-spawning the binary whose own output the sweep deletes is the failure the
    // single-process sweep exists to prevent. The substitute fails if spawned, so a clean sweep proves it was not.
    const { a, b } = scaffoldWorkspace(root);
    scaffoldConfig(root, { devBin: { 'nmr-clean': 'exit 7' } });

    await runClean(root);

    expect(hasOutput(a)).toBe(false);
    expect(hasOutput(b)).toBe(false);
  });

  it('skips a package whose clean resolves to an empty command', async () => {
    // An empty script is the package.json convention for "skip this command", so the sweep must leave the
    // output of a package that opted out of cleaning intact.
    const { a, b } = scaffoldWorkspace(root);
    fs.writeFileSync(
      path.join(a, 'package.json'),
      JSON.stringify({ name: 'a', type: 'module', scripts: { clean: '' } }),
    );

    await runClean(root);

    expect(hasOutput(a)).toBe(true);
    expect(hasOutput(b)).toBe(false);
  });
});

/** Returns true if the `dist` directory exists. */
function hasOutput(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'dist'));
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
