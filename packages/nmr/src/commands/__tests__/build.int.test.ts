import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as ts from 'typescript';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildPackage, resolveBuildCachePath } from '../build.ts';

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
function scaffoldPackage(
  dir: string,
  sources: Record<string, string>,
  extraCompilerOptions: Record<string, unknown> = {},
): void {
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module' }));
  // Give the fixture its own node_modules so the build cache resolves inside the temp dir (hermetic,
  // cleaned up with it) rather than to some ancestor node_modules above the OS temp root.
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  const tsconfig = {
    ...TSCONFIG,
    compilerOptions: { ...TSCONFIG.compilerOptions, ...extraCompilerOptions },
  };
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(tsconfig));
  for (const [relativePath, contents] of Object.entries(sources)) {
    const filePath = path.join(dir, 'src', relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  }
}

function readOutput(dir: string, relativePath: string): string {
  return fs.readFileSync(path.join(dir, 'dist', 'esm', relativePath), 'utf8');
}

/**
 * Writes a package under `rootDir/pkg` whose own tsconfig declares no `paths`; instead it `extends` a
 * base config in the parent directory that supplies `baseUrl` and `paths`. This mirrors the real
 * package layout (every package inherits `paths` from the repo-root config), where TypeScript anchors
 * inherited `paths` to the base config's directory rather than the leaf's.
 */
function scaffoldExtendedBasePackage(rootDir: string): string {
  const packageDir = path.join(rootDir, 'pkg');
  fs.mkdirSync(path.join(packageDir, 'src', 'nested'), { recursive: true });
  fs.mkdirSync(path.join(packageDir, 'node_modules'), { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, 'tsconfig.base.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ES2022',
        allowImportingTsExtensions: true,
        declaration: true,
        strict: true,
        baseUrl: '.',
        paths: { '~/*': ['./pkg/src/*'] },
      },
    }),
  );
  fs.writeFileSync(
    path.join(packageDir, 'tsconfig.json'),
    JSON.stringify({ extends: '../tsconfig.base.json', include: ['src/'] }),
  );
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module' }));
  fs.writeFileSync(
    path.join(packageDir, 'src', 'helper.ts'),
    'export const helper = 1;\nexport type Thing = { n: number };\n',
  );
  fs.writeFileSync(
    path.join(packageDir, 'src', 'index.ts'),
    `import { helper, type Thing } from '~/helper.ts';\nexport const value: Thing = { n: helper };\n`,
  );
  fs.writeFileSync(
    path.join(packageDir, 'src', 'nested', 'leaf.ts'),
    `import { helper } from '~/helper.ts';\nexport const leaf = helper;\n`,
  );
  return packageDir;
}

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
      'nested/leaf.ts': `import { helper, type Thing } from '~/helper.ts';\nexport const leaf: Thing = { n: helper };\n`,
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

  it('rewrites a bare side-effect import to .js in both outputs', () => {
    expect(readOutput(dir, 'index.js')).toMatch(/import ["']\.\/side\.js["']/);
    expect(readOutput(dir, 'index.d.ts')).toMatch(/import ["']\.\/side\.js["']/);
  });

  it('leaves a .ts specifier inside a string literal untouched in both outputs', () => {
    expect(readOutput(dir, 'index.js')).toContain(`import x from './decoy.ts'`);
    expect(readOutput(dir, 'index.d.ts')).toContain(`import x from './decoy.ts'`);
  });

  it('rewrites a tsconfig paths alias to a relative .js specifier in both outputs', () => {
    const js = readOutput(dir, 'index.js');
    const dts = readOutput(dir, 'index.d.ts');
    expect(js).toMatch(/from ["']\.\/helper\.js["']/);
    expect(js).not.toContain('~/');
    expect(dts).toMatch(/from ["']\.\/helper\.js["']/);
    expect(dts).not.toContain('~/');
  });

  it('resolves an alias relative to the importing file in a nested directory in both outputs', () => {
    expect(readOutput(dir, 'nested/leaf.js')).toMatch(/from ["']\.\.\/helper\.js["']/);
    expect(readOutput(dir, 'nested/leaf.d.ts')).toMatch(/from ["']\.\.\/helper\.js["']/);
  });

  it('rewrites a re-export specifier to .js in both outputs', () => {
    expect(readOutput(dir, 'index.js')).toMatch(/from ["']\.\/reexport\.js["']/);
    expect(readOutput(dir, 'index.d.ts')).toMatch(/from ["']\.\/reexport\.js["']/);
  });
});

describe('buildPackage emit correctness', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-build-emit-'));
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.mocked(console.info).mockRestore();
    vi.mocked(ts.createProgram).mockClear();
  });

  it('throws when an aliased import resolves to a missing file', async () => {
    scaffoldPackage(dir, {
      'index.ts': `import { missing } from '~/nonexistent.ts';\nexport const value = missing;\n`,
    });

    await expect(buildPackage(dir)).rejects.toThrow(/could not resolve aliased import '~\/nonexistent\.ts'/);
  });

  it('emits declaration files under outDir even when tsconfig sets declarationDir', async () => {
    scaffoldPackage(
      dir,
      {
        'helper.ts': 'export const helper = 1;\nexport type Thing = { n: number };\n',
        'index.ts': `import { helper, type Thing } from '~/helper.ts';\nexport const value: Thing = { n: helper };\n`,
      },
      { declarationDir: './types' },
    );

    await buildPackage(dir);

    expect(fs.existsSync(path.join(dir, 'dist', 'esm', 'index.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'types', 'index.d.ts'))).toBe(false);
    expect(readOutput(dir, 'index.d.ts')).toMatch(/from ["']\.\/helper\.js["']/);
  });

  it('rejects when the resolved TypeScript version is older than the supported floor', async () => {
    scaffoldPackage(dir, { 'index.ts': 'export const value = 1;\n' });

    // `ts.versionMajorMinor` is typed as the literal installed version; alias to a widened view so
    // the spy can return an older value. Force it below the >=5.7 floor and restore in finally so
    // the override cannot leak into sibling tests.
    const tsModule: { versionMajorMinor: string } = ts;
    const versionSpy = vi.spyOn(tsModule, 'versionMajorMinor', 'get').mockReturnValue('5.6');
    try {
      await expect(buildPackage(dir)).rejects.toThrow(/requires TypeScript >=5\.7/);
    } finally {
      versionSpy.mockRestore();
    }
  });

  it('rewrites an inline import-type alias to a relative .js specifier in the emitted .d.ts', async () => {
    scaffoldPackage(dir, {
      'helper.ts': 'export type Thing = { n: number };\n',
      'index.ts': `export type Wrapped = { value: import('~/helper.ts').Thing };\n`,
    });

    await buildPackage(dir);

    const declaration = readOutput(dir, 'index.d.ts');
    expect(declaration).toMatch(/import\(["']\.\/helper\.js["']\)\.Thing/);
    expect(declaration).not.toContain('~/helper.ts');
    expect(declaration).not.toContain('./helper.ts');
  });
});

describe('buildPackage with extends-inherited tsconfig paths', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-build-extends-'));
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.mocked(console.info).mockRestore();
    vi.mocked(ts.createProgram).mockClear();
  });

  it('rewrites a base-config-inherited paths alias to a relative .js specifier in both outputs', async () => {
    const packageDir = scaffoldExtendedBasePackage(dir);

    await buildPackage(packageDir);

    const js = fs.readFileSync(path.join(packageDir, 'dist', 'esm', 'index.js'), 'utf8');
    const dts = fs.readFileSync(path.join(packageDir, 'dist', 'esm', 'index.d.ts'), 'utf8');
    expect(js).toMatch(/from ["']\.\/helper\.js["']/);
    expect(js).not.toContain('~/');
    expect(dts).toMatch(/from ["']\.\/helper\.js["']/);
    expect(dts).not.toContain('~/');
  });

  it('resolves a base-config-inherited alias relative to a nested importing file', async () => {
    const packageDir = scaffoldExtendedBasePackage(dir);

    await buildPackage(packageDir);

    expect(fs.readFileSync(path.join(packageDir, 'dist', 'esm', 'nested', 'leaf.js'), 'utf8')).toMatch(
      /from ["']\.\.\/helper\.js["']/,
    );
  });

  it('rebuilds when a base config in the extends chain changes', async () => {
    const packageDir = scaffoldExtendedBasePackage(dir);
    await buildPackage(packageDir);

    // Change only the base config; the package's own tsconfig and sources stay byte-identical, so a
    // cache that ignored the extends chain would skip this rebuild and ship stale output.
    const basePath = path.join(dir, 'tsconfig.base.json');
    fs.writeFileSync(basePath, fs.readFileSync(basePath, 'utf8').replace('"ES2022"', '"ES2021"'));

    await buildPackage(packageDir);

    expect(ts.createProgram).toHaveBeenCalledTimes(2);
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
    expect(fs.existsSync(resolveBuildCachePath(dir))).toBe(true);

    // Only the second (unchanged) build logs "No changes detected"; the first logs "Changes detected".
    await buildPackage(dir);

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('No changes detected'));
  });

  it('writes the cache under node_modules/.cache/nmr-compile, never inside dist', async () => {
    scaffoldPackage(dir, { 'index.ts': 'export const value = 1;\n' });

    await buildPackage(dir);

    const cachePath = resolveBuildCachePath(dir);
    expect(cachePath).toContain(path.join('node_modules', '.cache', 'nmr-compile'));
    expect(fs.existsSync(cachePath)).toBe(true);
    // The regression this guards: the digest must not land inside the published dist tree.
    expect(fs.existsSync(path.join(dir, 'dist', 'esm', '.cache'))).toBe(false);
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

    expect(fs.existsSync(resolveBuildCachePath(dir))).toBe(false);
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
    expect(fs.existsSync(resolveBuildCachePath(dir))).toBe(true);
  });

  it('preserves an existing cache when a changed-source rebuild fails', async () => {
    scaffoldPackage(dir, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(dir);
    const cachePath = resolveBuildCachePath(dir);
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

describe('resolveBuildCachePath', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-cache-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("places the cache in the package's own node_modules when it has one", () => {
    const packageDir = path.join(root, 'pkg');
    fs.mkdirSync(path.join(packageDir, 'node_modules'), { recursive: true });

    expect(path.dirname(resolveBuildCachePath(packageDir))).toBe(
      path.join(packageDir, 'node_modules', '.cache', 'nmr-compile'),
    );
  });

  it('falls back to the nearest ancestor node_modules for a package that has none', () => {
    // Mirrors a zero-dependency workspace leaf (e.g. nmr-core): with no node_modules of its own, the
    // cache must resolve to a hoisted ancestor rather than a stray directory beside dist.
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    const packageDir = path.join(root, 'packages', 'leaf');
    fs.mkdirSync(packageDir, { recursive: true });

    expect(path.dirname(resolveBuildCachePath(packageDir))).toBe(
      path.join(root, 'node_modules', '.cache', 'nmr-compile'),
    );
  });

  it('derives a stable, package-specific key', () => {
    const a = path.join(root, 'a');
    const b = path.join(root, 'b');
    fs.mkdirSync(path.join(a, 'node_modules'), { recursive: true });
    fs.mkdirSync(path.join(b, 'node_modules'), { recursive: true });

    expect(resolveBuildCachePath(a)).toBe(resolveBuildCachePath(a));
    expect(resolveBuildCachePath(a)).not.toBe(resolveBuildCachePath(b));
  });
});
