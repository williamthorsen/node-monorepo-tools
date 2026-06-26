import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { build } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildPackage, computeBuildHash, resolveAliasImports, rewriteTsImportExtensions } from '../build.ts';

// Default esbuild's build to the real implementation so the success-path tests compile for real;
// the cache-integrity tests override it per-call to simulate a failing or transient compile.
vi.mock('esbuild', async (importOriginal) => {
  const actual = await importOriginal<typeof import('esbuild')>();
  return { ...actual, build: vi.fn(actual.build) };
});

describe(computeBuildHash, () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-build-hash-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns the same digest regardless of entry-point order', async () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1;');
    fs.writeFileSync(path.join(dir, 'b.ts'), 'export const b = 2;');

    const forward = await computeBuildHash(dir, ['a.ts', 'b.ts'], { format: 'esm' });
    const reversed = await computeBuildHash(dir, ['b.ts', 'a.ts'], { format: 'esm' });

    expect(reversed).toBe(forward);
  });

  it('changes the digest when a file path changes but its content does not', async () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const x = 1;');
    fs.writeFileSync(path.join(dir, 'b.ts'), 'export const x = 1;');

    const asA = await computeBuildHash(dir, ['a.ts'], { format: 'esm' });
    const asB = await computeBuildHash(dir, ['b.ts'], { format: 'esm' });

    expect(asB).not.toBe(asA);
  });

  it('changes the digest when file content changes', async () => {
    const file = path.join(dir, 'a.ts');
    fs.writeFileSync(file, 'export const x = 1;');
    const before = await computeBuildHash(dir, ['a.ts'], { format: 'esm' });

    fs.writeFileSync(file, 'export const x = 2;');
    const after = await computeBuildHash(dir, ['a.ts'], { format: 'esm' });

    expect(after).not.toBe(before);
  });

  it('changes the digest when output config changes', async () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const x = 1;');

    const esm = await computeBuildHash(dir, ['a.ts'], { format: 'esm' });
    const cjs = await computeBuildHash(dir, ['a.ts'], { format: 'cjs' });

    expect(cjs).not.toBe(esm);
  });
});

describe(resolveAliasImports, () => {
  const packageDir = path.resolve('/repo/pkg');
  const fileDir = path.join(packageDir, 'src');
  const aliasMap = { '~/': '.' };

  it('rewrites a ~/src import to a sibling-relative path', () => {
    const out = resolveAliasImports(`import { util } from '~/src/util.ts';`, fileDir, aliasMap, packageDir);

    expect(out).toContain(`from './util.ts'`);
  });

  it('rewrites a ~/ import outside src to a parent-relative path', () => {
    const out = resolveAliasImports(`import data from '~/config/data.ts';`, fileDir, aliasMap, packageDir);

    expect(out).toContain(`from '../config/data.ts'`);
  });

  it('leaves an already-relative import unchanged', () => {
    const code = `import x from './sibling.ts';`;

    expect(resolveAliasImports(code, fileDir, aliasMap, packageDir)).toBe(code);
  });
});

describe(rewriteTsImportExtensions, () => {
  it('rewrites a sibling .ts import to .js', () => {
    expect(rewriteTsImportExtensions(`import x from './util.ts';`)).toContain(`from './util.js'`);
  });

  it('rewrites a parent-relative .ts import to .js', () => {
    expect(rewriteTsImportExtensions(`import x from '../config/data.ts';`)).toContain(`from '../config/data.js'`);
  });

  it('leaves a bare package import unchanged', () => {
    const code = `import { build } from 'esbuild';`;

    expect(rewriteTsImportExtensions(code)).toBe(code);
  });
});

describe(buildPackage, () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-build-'));
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.mocked(console.info).mockRestore();
    // Clear call history but keep the real default implementation for the next test.
    vi.mocked(build).mockClear();
  });

  function scaffoldPackage(): void {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture' }));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'util.ts'), 'export const util = 1;\n');
    fs.writeFileSync(
      path.join(dir, 'src', 'index.ts'),
      `import { util } from '~/src/util.ts';\nexport const value = util;\n`,
    );
  }

  it('compiles src to dist/esm with aliases and extensions rewritten', async () => {
    scaffoldPackage();

    await buildPackage(dir);

    const out = fs.readFileSync(path.join(dir, 'dist', 'esm', 'index.js'), 'utf8');
    expect(out).toContain('./util.js');
    expect(out).not.toContain('~/src');
  });

  it('writes a cache file and skips an unchanged rebuild', async () => {
    scaffoldPackage();
    await buildPackage(dir);
    expect(fs.existsSync(path.join(dir, 'dist', 'esm', '.cache'))).toBe(true);

    // Only the second (unchanged) build logs "No changes detected"; the first logs "Changes detected".
    await buildPackage(dir);

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('No changes detected'));
  });

  it('reports the package directory name and 📦 icon when changes are detected', async () => {
    scaffoldPackage();

    await buildPackage(dir);

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('📦'));
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining(path.basename(dir)));
  });

  it('does not write the build cache when the compile fails', async () => {
    scaffoldPackage();
    vi.mocked(build).mockRejectedValueOnce(new Error('compile failed'));

    await expect(buildPackage(dir)).rejects.toThrow('compile failed');

    expect(fs.existsSync(path.join(dir, 'dist', 'esm', '.cache'))).toBe(false);
  });

  it('re-attempts and rebuilds after a transient compile failure instead of skipping', async () => {
    scaffoldPackage();
    vi.mocked(build).mockRejectedValueOnce(new Error('transient failure'));
    await expect(buildPackage(dir)).rejects.toThrow();

    // Sources are unchanged: a cache poisoned by the failed run would make this skip the compile.
    // Instead it must re-attempt, and with the transient failure gone, produce output and cache it.
    await buildPackage(dir);

    expect(build).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(path.join(dir, 'dist', 'esm', 'index.js'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'dist', 'esm', '.cache'))).toBe(true);
  });

  it('preserves an existing cache when a changed-source rebuild fails', async () => {
    scaffoldPackage();
    await buildPackage(dir);
    const cachePath = path.join(dir, 'dist', 'esm', '.cache');
    const lastGoodDigest = fs.readFileSync(cachePath, 'utf8');

    // A changed source forces the rebuild to be attempted rather than skipped; make that rebuild fail.
    fs.writeFileSync(path.join(dir, 'src', 'util.ts'), 'export const util = 2;\n');
    vi.mocked(build).mockRejectedValueOnce(new Error('rebuild failed'));
    await expect(buildPackage(dir)).rejects.toThrow();

    // The failed rebuild must leave the last successful build's digest intact, not overwrite it.
    expect(fs.readFileSync(cachePath, 'utf8')).toBe(lastGoodDigest);

    // With the failure gone, the next run rebuilds the changed source and refreshes the cache.
    await buildPackage(dir);
    expect(fs.readFileSync(path.join(dir, 'dist', 'esm', 'util.js'), 'utf8')).toContain('util = 2');
    expect(fs.readFileSync(cachePath, 'utf8')).not.toBe(lastGoodDigest);
  });
});
