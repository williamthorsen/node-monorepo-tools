import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as ts from 'typescript';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildPackage, computeBuildHash } from '../build.ts';

// Default the compiler API to the real implementation so the regression suite compiles for real;
// the cache-integrity tests override createProgram per-call to simulate a failing or transient compile.
vi.mock('typescript', async (importOriginal) => {
  const actual = await importOriginal<typeof import('typescript')>();
  return { ...actual, createProgram: vi.fn(actual.createProgram) };
});

const TSCONFIG = {
  compilerOptions: {
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    target: 'ES2022',
    allowImportingTsExtensions: true,
    declaration: true,
    strict: true,
    baseUrl: '.',
    paths: { '~/*': ['./src/*'] },
  },
  include: ['src/'],
};

/** Writes a self-contained package tree (package.json, tsconfig.json, and the given `src` files). */
function scaffoldPackage(dir: string, sources: Record<string, string>): void {
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module' }));
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(TSCONFIG));
  for (const [relativePath, contents] of Object.entries(sources)) {
    const filePath = path.join(dir, 'src', relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  }
}

function readOutput(dir: string, relativePath: string): string {
  return fs.readFileSync(path.join(dir, 'dist', 'esm', relativePath), 'utf8');
}

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

    const forward = await computeBuildHash(dir, ['a.ts', 'b.ts'], { outdir: 'dist/esm/' });
    const reversed = await computeBuildHash(dir, ['b.ts', 'a.ts'], { outdir: 'dist/esm/' });

    expect(reversed).toBe(forward);
  });

  it('changes the digest when a file path changes but its content does not', async () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const x = 1;');
    fs.writeFileSync(path.join(dir, 'b.ts'), 'export const x = 1;');

    const asA = await computeBuildHash(dir, ['a.ts'], { outdir: 'dist/esm/' });
    const asB = await computeBuildHash(dir, ['b.ts'], { outdir: 'dist/esm/' });

    expect(asB).not.toBe(asA);
  });

  it('changes the digest when file content changes', async () => {
    const file = path.join(dir, 'a.ts');
    fs.writeFileSync(file, 'export const x = 1;');
    const before = await computeBuildHash(dir, ['a.ts'], { outdir: 'dist/esm/' });

    fs.writeFileSync(file, 'export const x = 2;');
    const after = await computeBuildHash(dir, ['a.ts'], { outdir: 'dist/esm/' });

    expect(after).not.toBe(before);
  });

  it('changes the digest when emit config changes', async () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const x = 1;');

    const esm = await computeBuildHash(dir, ['a.ts'], { outdir: 'dist/esm/' });
    const other = await computeBuildHash(dir, ['a.ts'], { outdir: 'dist/cjs/' });

    expect(other).not.toBe(esm);
  });
});

describe('buildPackage regression suite', () => {
  let dir: string;

  beforeAll(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-build-regression-'));
    scaffoldPackage(dir, {
      'helper.ts': 'export const helper = 1;\nexport type Thing = { n: number };\n',
      'side.ts': 'export {};\n',
      'reexport.ts': 'export const reexport = 2;\n',
      'dyn.ts': 'export const dyn = 3;\n',
      'nested/leaf.ts': `import { helper } from '~/helper.ts';\nexport const leaf = helper;\n`,
      'index.ts':
        [
          `import './side.ts';`,
          `import { helper } from '~/helper.ts';`,
          `export { reexport } from './reexport.ts';`,
          `export type { Thing } from '~/helper.ts';`,
          `export { leaf } from './nested/leaf.ts';`,
          `export async function load() { return import('./dyn.ts'); }`,
          `export const decoy = "import x from './decoy.ts'";`,
          `export const value = helper;`,
        ].join('\n') + '\n',
    });
    await buildPackage(dir);
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.mocked(console.info).mockRestore();
  });

  it('rewrites a dynamic import() specifier to .js in the emitted .js', () => {
    expect(readOutput(dir, 'index.js')).toMatch(/import\(["']\.\/dyn\.js["']\)/);
  });

  it('rewrites a dynamic import() type specifier to .js in the emitted .d.ts', () => {
    expect(readOutput(dir, 'index.d.ts')).toMatch(/import\(["']\.\/dyn\.js["']\)/);
  });

  it('rewrites a bare side-effect import to .js in the emitted .js', () => {
    expect(readOutput(dir, 'index.js')).toMatch(/import ["']\.\/side\.js["']/);
  });

  it('rewrites a bare side-effect import to .js in the emitted .d.ts', () => {
    expect(readOutput(dir, 'index.d.ts')).toMatch(/import ["']\.\/side\.js["']/);
  });

  it('leaves a .ts specifier inside a string literal untouched in the emitted .js', () => {
    expect(readOutput(dir, 'index.js')).toContain(`import x from './decoy.ts'`);
  });

  it('leaves a .ts specifier inside a string literal untouched in the emitted .d.ts', () => {
    expect(readOutput(dir, 'index.d.ts')).toContain(`import x from './decoy.ts'`);
  });

  it('rewrites a tsconfig paths alias to a relative .js specifier in the emitted .js', () => {
    const out = readOutput(dir, 'index.js');
    expect(out).toMatch(/from ["']\.\/helper\.js["']/);
    expect(out).not.toContain('~/');
  });

  it('rewrites a tsconfig paths alias to a relative .js specifier in the emitted .d.ts', () => {
    const out = readOutput(dir, 'index.d.ts');
    expect(out).toMatch(/from ["']\.\/helper\.js["']/);
    expect(out).not.toContain('~/');
  });

  it('resolves an alias relative to the importing file in a nested directory', () => {
    expect(readOutput(dir, 'nested/leaf.js')).toMatch(/from ["']\.\.\/helper\.js["']/);
  });

  it('rewrites a re-export specifier to .js in both outputs', () => {
    expect(readOutput(dir, 'index.js')).toMatch(/from ["']\.\/reexport\.js["']/);
    expect(readOutput(dir, 'index.d.ts')).toMatch(/from ["']\.\/reexport\.js["']/);
  });
});

describe('buildPackage caching', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-build-'));
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.mocked(console.info).mockRestore();
    // Clear call history but keep the real default implementation for the next test.
    vi.mocked(ts.createProgram).mockClear();
  });

  it('compiles src to dist/esm', async () => {
    scaffoldPackage(dir, {
      'index.ts': `export { helper } from './helper.ts';\n`,
      'helper.ts': 'export const helper = 1;\n',
    });

    await buildPackage(dir);

    expect(readOutput(dir, 'index.js')).toContain('./helper.js');
  });

  it('writes a cache file and skips an unchanged rebuild', async () => {
    scaffoldPackage(dir, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(dir);
    expect(fs.existsSync(path.join(dir, 'dist', 'esm', '.cache'))).toBe(true);

    // Only the second (unchanged) build logs "No changes detected"; the first logs "Changes detected".
    await buildPackage(dir);

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('No changes detected'));
  });

  it('reports the package directory name and 📦 icon when changes are detected', async () => {
    scaffoldPackage(dir, { 'index.ts': 'export const value = 1;\n' });

    await buildPackage(dir);

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('📦'));
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining(path.basename(dir)));
  });

  it('does not write the build cache when the compile fails', async () => {
    scaffoldPackage(dir, { 'index.ts': 'export const value = 1;\n' });
    vi.mocked(ts.createProgram).mockImplementationOnce(() => {
      throw new Error('compile failed');
    });

    await expect(buildPackage(dir)).rejects.toThrow('compile failed');

    expect(fs.existsSync(path.join(dir, 'dist', 'esm', '.cache'))).toBe(false);
  });

  it('re-attempts and rebuilds after a transient compile failure instead of skipping', async () => {
    scaffoldPackage(dir, { 'index.ts': 'export const value = 1;\n' });
    vi.mocked(ts.createProgram).mockImplementationOnce(() => {
      throw new Error('transient failure');
    });
    await expect(buildPackage(dir)).rejects.toThrow();

    // Sources are unchanged: a cache poisoned by the failed run would make this skip the compile.
    // Instead it must re-attempt, and with the transient failure gone, produce output and cache it.
    await buildPackage(dir);

    expect(ts.createProgram).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(path.join(dir, 'dist', 'esm', 'index.js'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'dist', 'esm', '.cache'))).toBe(true);
  });

  it('preserves an existing cache when a changed-source rebuild fails', async () => {
    scaffoldPackage(dir, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(dir);
    const cachePath = path.join(dir, 'dist', 'esm', '.cache');
    const lastGoodDigest = fs.readFileSync(cachePath, 'utf8');

    // A changed source forces the rebuild to be attempted rather than skipped; make that rebuild fail.
    fs.writeFileSync(path.join(dir, 'src', 'index.ts'), 'export const value = 2;\n');
    vi.mocked(ts.createProgram).mockImplementationOnce(() => {
      throw new Error('rebuild failed');
    });
    await expect(buildPackage(dir)).rejects.toThrow();

    // The failed rebuild must leave the last successful build's digest intact, not overwrite it.
    expect(fs.readFileSync(cachePath, 'utf8')).toBe(lastGoodDigest);

    // With the failure gone, the next run rebuilds the changed source and refreshes the cache.
    await buildPackage(dir);
    expect(readOutput(dir, 'index.js')).toContain('value = 2');
    expect(fs.readFileSync(cachePath, 'utf8')).not.toBe(lastGoodDigest);
  });
});
