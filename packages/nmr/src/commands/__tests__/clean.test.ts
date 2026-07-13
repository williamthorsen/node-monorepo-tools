import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveBuildCachePath } from '../build.ts';
import { cleanPackage } from '../clean.ts';

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
