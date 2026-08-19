import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { disposeOnTestFinished, makeFixture, silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import * as ts from 'typescript';
import { afterEach, assert, beforeEach, describe, expect, it as baseIt, vi } from 'vitest';

import { buildPackage } from '../build.ts';
import { resolveBuildCachePath, resolveScratchDirs } from '../build-output.ts';

// Default the compiler API to the real implementation so the regression suite compiles for real;
// the cache-integrity tests override createProgram per-call to simulate a failing or transient compile.
vi.mock(import('typescript'), async (importOriginal) => {
  const actual = await importOriginal();
  // Attach the implementation after construction. Passing it to `vi.fn` would infer the overloaded signature of
  // `createProgram`, and `Mock<T>` collapses an overload set to its last member, which the module's shape rejects.
  const createProgram = vi.fn();
  createProgram.mockImplementation(actual.createProgram);
  return { ...actual, createProgram };
});

/** One edit to a package's `.config/nmr.config.ts`, applied by path so a case can create, rewrite, or delete it. */
type ConfigStep = (configPath: string) => void;

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

/**
 * Writes a package under `rootDir/pkg` whose inherited `~/*` alias is anchored at `rootDir` and maps to
 * `rootDir` itself, so an import of `~/rootFile.ts` resolves to a file above the package's `src/`. This
 * reproduces the reported case: a package inheriting a root-anchored alias whose target escapes the
 * package source tree, where the specifier is unresolvable at runtime because Node never sees `paths`.
 */
function scaffoldRootEscapingAliasPackage(rootDir: string): string {
  const packageDir = path.join(rootDir, 'pkg');
  fs.mkdirSync(path.join(packageDir, 'src'), { recursive: true });
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
        paths: { '~/*': ['./*'] },
      },
    }),
  );
  fs.writeFileSync(
    path.join(packageDir, 'tsconfig.json'),
    JSON.stringify({ extends: '../tsconfig.base.json', include: ['src/'] }),
  );
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module' }));
  fs.writeFileSync(path.join(rootDir, 'rootFile.ts'), 'export const rootValue = 1;\n');
  fs.writeFileSync(
    path.join(packageDir, 'src', 'index.ts'),
    `import { rootValue } from '~/rootFile.ts';\nexport const value = rootValue;\n`,
  );
  return packageDir;
}

/**
 * Writes a package under `rootDir/pkg` whose inherited alias maps `packages/*` to a sibling `packages/`
 * tree, so `import 'packages/foo/src/x.ts'` escapes the package's `src/`. The target is reachable through
 * the inherited `baseUrl` as well, so a fallback that emulated the runtime by stripping only `paths` would
 * still resolve it and emit it verbatim — yet Node, which honors neither `baseUrl` nor `paths`, cannot
 * load the bare specifier at runtime.
 */
function scaffoldBaseUrlReachableEscapingAliasPackage(rootDir: string): string {
  const packageDir = path.join(rootDir, 'pkg');
  fs.mkdirSync(path.join(packageDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(packageDir, 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'packages', 'foo', 'src'), { recursive: true });
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
        paths: { 'packages/*': ['./packages/*'] },
      },
    }),
  );
  fs.writeFileSync(
    path.join(packageDir, 'tsconfig.json'),
    JSON.stringify({ extends: '../tsconfig.base.json', include: ['src/'] }),
  );
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module' }));
  fs.writeFileSync(path.join(rootDir, 'packages', 'foo', 'src', 'x.ts'), 'export const x = 1;\n');
  fs.writeFileSync(
    path.join(packageDir, 'src', 'index.ts'),
    `import { x } from 'packages/foo/src/x.ts';\nexport const value = x;\n`,
  );
  return packageDir;
}

const it = baseIt
  // eslint-disable-next-line no-empty-pattern -- Vitest parses a fixture's first parameter and rejects anything but a destructuring pattern.
  .extend('builtPackage', { scope: 'file' }, async ({}, { onCleanup }) => {
    using stack = new DisposableStack();
    const tree = stack.use(createTempTree({}, { prefix: 'nmr-build-regression-' }));
    scaffoldPackage(tree.dir, {
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

    // Silenced for the compile alone. A file-scoped silencer would hand its call history to every later
    // per-test spy, which is what the caching block's negative `console.info` assertions read.
    {
      using _silent = silenceConsole(['info']);
      await buildPackage(tree.dir);
    }

    const owned = stack.move();
    onCleanup(() => {
      owned.dispose();
    });

    return tree;
  })
  .extend(
    'tree',
    makeFixture(() => createTempTree({}, { prefix: 'nmr-build-' })),
  );

describe('buildPackage regression suite', () => {
  it('rewrites a dynamic import() specifier to .js in the emitted .js', ({ builtPackage }) => {
    expect(readOutput(builtPackage.dir, 'index.js')).toMatch(/import\(["']\.\/dyn\.js["']\)/);
  });

  it('rewrites a dynamic import() type specifier to .js in the emitted .d.ts', ({ builtPackage }) => {
    expect(readOutput(builtPackage.dir, 'index.d.ts')).toMatch(/import\(["']\.\/dyn\.js["']\)/);
  });

  it('rewrites a bare side-effect import to .js in both outputs', ({ builtPackage }) => {
    expect(readOutput(builtPackage.dir, 'index.js')).toMatch(/import ["']\.\/side\.js["']/);
    expect(readOutput(builtPackage.dir, 'index.d.ts')).toMatch(/import ["']\.\/side\.js["']/);
  });

  it('leaves a .ts specifier inside a string literal untouched in both outputs', ({ builtPackage }) => {
    expect(readOutput(builtPackage.dir, 'index.js')).toContain(`import x from './decoy.ts'`);
    expect(readOutput(builtPackage.dir, 'index.d.ts')).toContain(`import x from './decoy.ts'`);
  });

  it('rewrites a tsconfig paths alias to a relative .js specifier in both outputs', ({ builtPackage }) => {
    const js = readOutput(builtPackage.dir, 'index.js');
    const dts = readOutput(builtPackage.dir, 'index.d.ts');
    expect(js).toMatch(/from ["']\.\/helper\.js["']/);
    expect(js).not.toContain('~/');
    expect(dts).toMatch(/from ["']\.\/helper\.js["']/);
    expect(dts).not.toContain('~/');
  });

  it('resolves an alias relative to the importing file in a nested directory in both outputs', ({ builtPackage }) => {
    expect(readOutput(builtPackage.dir, 'nested/leaf.js')).toMatch(/from ["']\.\.\/helper\.js["']/);
    expect(readOutput(builtPackage.dir, 'nested/leaf.d.ts')).toMatch(/from ["']\.\.\/helper\.js["']/);
  });

  it('rewrites a re-export specifier to .js in both outputs', ({ builtPackage }) => {
    expect(readOutput(builtPackage.dir, 'index.js')).toMatch(/from ["']\.\/reexport\.js["']/);
    expect(readOutput(builtPackage.dir, 'index.d.ts')).toMatch(/from ["']\.\/reexport\.js["']/);
  });
});

describe('buildPackage emit correctness', () => {
  beforeEach(() => {
    disposeOnTestFinished(silenceConsole(['info']));
  });

  afterEach(() => {
    vi.mocked(ts.createProgram).mockClear();
  });

  it('throws when an aliased import resolves to a missing file', async ({ tree }) => {
    scaffoldPackage(tree.dir, {
      'index.ts': `import { missing } from '~/nonexistent.ts';\nexport const value = missing;\n`,
    });

    await expect(buildPackage(tree.dir)).rejects.toThrow(/could not resolve aliased import '~\/nonexistent\.ts'/);
  });

  it('emits declaration files under outDir even when tsconfig sets declarationDir', async ({ tree }) => {
    scaffoldPackage(
      tree.dir,
      {
        'helper.ts': 'export const helper = 1;\nexport type Thing = { n: number };\n',
        'index.ts': `import { helper, type Thing } from '~/helper.ts';\nexport const value: Thing = { n: helper };\n`,
      },
      { declarationDir: './types' },
    );

    await buildPackage(tree.dir);

    expect(fs.existsSync(path.join(tree.dir, 'dist', 'esm', 'index.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tree.dir, 'types', 'index.d.ts'))).toBe(false);
    expect(readOutput(tree.dir, 'index.d.ts')).toMatch(/from ["']\.\/helper\.js["']/);
  });

  it('rejects when the resolved TypeScript version is older than the supported floor', async ({ tree }) => {
    scaffoldPackage(tree.dir, { 'index.ts': 'export const value = 1;\n' });

    // `ts.versionMajorMinor` is typed as the literal installed version; alias to a widened view so
    // the spy can return an older value. Force it below the >=5.7 floor and restore in finally so
    // the override cannot leak into sibling tests.
    const tsModule: { versionMajorMinor: string } = ts;
    const versionSpy = vi.spyOn(tsModule, 'versionMajorMinor', 'get').mockReturnValue('5.6');
    try {
      await expect(buildPackage(tree.dir)).rejects.toThrow(/requires TypeScript >=5\.7/);
    } finally {
      versionSpy.mockRestore();
    }
  });

  it('rewrites an inline import-type alias to a relative .js specifier in the emitted .d.ts', async ({ tree }) => {
    scaffoldPackage(tree.dir, {
      'helper.ts': 'export type Thing = { n: number };\n',
      'index.ts': `export type Wrapped = { value: import('~/helper.ts').Thing };\n`,
    });

    await buildPackage(tree.dir);

    const declaration = readOutput(tree.dir, 'index.d.ts');
    expect(declaration).toMatch(/import\(["']\.\/helper\.js["']\)\.Thing/);
    expect(declaration).not.toContain('~/helper.ts');
    expect(declaration).not.toContain('./helper.ts');
  });
});

describe('buildPackage with extends-inherited tsconfig paths', () => {
  beforeEach(() => {
    disposeOnTestFinished(silenceConsole(['info']));
  });

  afterEach(() => {
    vi.mocked(ts.createProgram).mockClear();
  });

  it('rewrites a base-config-inherited paths alias to a relative .js specifier in both outputs', async ({ tree }) => {
    const packageDir = scaffoldExtendedBasePackage(tree.dir);

    await buildPackage(packageDir);

    const js = fs.readFileSync(path.join(packageDir, 'dist', 'esm', 'index.js'), 'utf8');
    const dts = fs.readFileSync(path.join(packageDir, 'dist', 'esm', 'index.d.ts'), 'utf8');
    expect(js).toMatch(/from ["']\.\/helper\.js["']/);
    expect(js).not.toContain('~/');
    expect(dts).toMatch(/from ["']\.\/helper\.js["']/);
    expect(dts).not.toContain('~/');
  });

  it('resolves a base-config-inherited alias relative to a nested importing file', async ({ tree }) => {
    const packageDir = scaffoldExtendedBasePackage(tree.dir);

    await buildPackage(packageDir);

    expect(fs.readFileSync(path.join(packageDir, 'dist', 'esm', 'nested', 'leaf.js'), 'utf8')).toMatch(
      /from ["']\.\.\/helper\.js["']/,
    );
  });

  it('rebuilds when a base config in the extends chain changes', async ({ tree }) => {
    const packageDir = scaffoldExtendedBasePackage(tree.dir);
    await buildPackage(packageDir);

    // Change only the base config; the package's own tsconfig and sources stay byte-identical, so a
    // cache that ignored the extends chain would skip this rebuild and ship stale output.
    const basePath = path.join(tree.dir, 'tsconfig.base.json');
    fs.writeFileSync(basePath, fs.readFileSync(basePath, 'utf8').replace('"ES2022"', '"ES2021"'));

    await buildPackage(packageDir);

    expect(ts.createProgram).toHaveBeenCalledTimes(2);
  });
});

describe('buildPackage with an alias target outside the package source tree', () => {
  beforeEach(() => {
    disposeOnTestFinished(silenceConsole(['info']));
  });

  afterEach(() => {
    vi.mocked(ts.createProgram).mockClear();
  });

  it('fails the build when an aliased import resolves outside src and does not bare-resolve', async ({ tree }) => {
    // `~/rootFile.ts` resolves (via `paths`) to the root-level `rootFile.ts`, above the package's
    // `src/`; without `paths` it is unresolvable, so the emitted specifier would fail at runtime.
    const packageDir = scaffoldRootEscapingAliasPackage(tree.dir);

    await expect(buildPackage(packageDir)).rejects.toThrow(
      /aliased import '~\/rootFile\.ts' from .* resolves to .*rootFile\.ts/,
    );
  });

  it('fails the build when an escaping alias resolves only through baseUrl, which Node ignores', async ({ tree }) => {
    // `packages/foo/src/x.ts` is reachable through `baseUrl`, so a fallback that stripped only `paths`
    // would resolve it and emit it verbatim — then Node, ignoring `baseUrl`, throws at runtime.
    const packageDir = scaffoldBaseUrlReachableEscapingAliasPackage(tree.dir);

    await expect(buildPackage(packageDir)).rejects.toThrow(
      /aliased import 'packages\/foo\/src\/x\.ts' from .* resolves to .*x\.ts/,
    );
  });

  it('emits verbatim when an alias-prefix-matched specifier resolves outside src but bare-resolves', async ({
    tree,
  }) => {
    // A `paths` key `lodash` collides (via `startsWith`) with an innocent `lodash-es` import — a real
    // installed package outside `src/`. It resolves the same with or without `paths`, so it is genuinely
    // external and runtime-runnable and must ship verbatim rather than failing the build.
    scaffoldPackage(
      tree.dir,
      { 'index.ts': `import { merge } from 'lodash-es';\nexport const value = merge;\n` },
      { paths: { lodash: ['./src/lodash-shim.ts'] } },
    );
    const lodashEsDir = path.join(tree.dir, 'node_modules', 'lodash-es');
    fs.mkdirSync(lodashEsDir, { recursive: true });
    fs.writeFileSync(
      path.join(lodashEsDir, 'package.json'),
      JSON.stringify({
        name: 'lodash-es',
        version: '1.0.0',
        type: 'module',
        main: './index.js',
        types: './index.d.ts',
      }),
    );
    fs.writeFileSync(path.join(lodashEsDir, 'index.js'), 'export const merge = 1;\n');
    fs.writeFileSync(path.join(lodashEsDir, 'index.d.ts'), 'export declare const merge: number;\n');

    await buildPackage(tree.dir);

    expect(readOutput(tree.dir, 'index.js')).toMatch(/from ["']lodash-es["']/);
  });
});

describe('buildPackage entry-point selection', () => {
  beforeEach(() => {
    disposeOnTestFinished(silenceConsole(['info']));
  });

  afterEach(() => {
    vi.mocked(ts.createProgram).mockClear();
  });

  // `for` rather than `each`: only `for` hands the fixture context to the case body.
  it.for(['__fixtures__', '__mocks__', '__tests__', 'test-utils'])(
    'excludes %s/ from the default entry points',
    async (directory, { tree }) => {
      scaffoldPackage(tree.dir, {
        'index.ts': 'export const value = 1;\n',
        [`${directory}/helper.ts`]: 'export const helper = 1;\n',
      });

      await buildPackage(tree.dir);

      expect(listEmitted(tree.dir)).toStrictEqual(['index.d.ts', 'index.js']);
    },
  );

  it('emits a helper that production code imports, despite the ignore', async ({ tree }) => {
    // The ignore selects entry points; the compiler still emits whatever they reach. Suppressing a reachable
    // file would leave index.js importing a specifier that was never written.
    scaffoldPackage(tree.dir, {
      'index.ts': `import { helper } from './test-utils/helper.ts';\nexport const value = helper;\n`,
      'test-utils/helper.ts': 'export const helper = 1;\n',
    });

    await buildPackage(tree.dir);

    expect(listEmitted(tree.dir)).toContain('test-utils/helper.js');
  });

  it('replaces the default ignore set when given `ignorePatterns`', async ({ tree }) => {
    scaffoldPackage(tree.dir, {
      'index.ts': 'export const value = 1;\n',
      'test-utils/helper.ts': 'export const helper = 1;\n',
    });

    await buildPackage(tree.dir, { ignorePatterns: [] });

    expect(listEmitted(tree.dir)).toContain('test-utils/helper.js');
  });

  it('adds to the effective ignore set when given `extraIgnorePatterns`', async ({ tree }) => {
    scaffoldPackage(tree.dir, {
      'index.ts': 'export const value = 1;\n',
      'internal/helper.ts': 'export const helper = 1;\n',
    });

    await buildPackage(tree.dir, { extraIgnorePatterns: ['**/internal/**'] });

    expect(listEmitted(tree.dir)).toStrictEqual(['index.d.ts', 'index.js']);
  });

  it('composes `extraIgnorePatterns` onto an `ignorePatterns` override rather than onto the default', async ({
    tree,
  }) => {
    scaffoldPackage(tree.dir, {
      'index.ts': 'export const value = 1;\n',
      'internal/helper.ts': 'export const helper = 1;\n',
      'test-utils/helper.ts': 'export const helper = 1;\n',
    });

    // `ignorePatterns: []` drops the defaults, so test-utils/ returns as an entry point; the extras apply on top.
    await buildPackage(tree.dir, { ignorePatterns: [], extraIgnorePatterns: ['**/internal/**'] });

    expect(listEmitted(tree.dir)).toStrictEqual([
      'index.d.ts',
      'index.js',
      'test-utils/helper.d.ts',
      'test-utils/helper.js',
    ]);
  });
});

describe('buildPackage output-directory ownership', () => {
  beforeEach(() => {
    disposeOnTestFinished(silenceConsole(['info']));
  });

  afterEach(() => {
    vi.mocked(ts.createProgram).mockClear();
  });

  it('drops output whose source has been deleted', async ({ tree }) => {
    scaffoldPackage(tree.dir, {
      'index.ts': 'export const value = 1;\n',
      'obsolete.ts': 'export const obsolete = 1;\n',
    });
    await buildPackage(tree.dir);
    expect(listEmitted(tree.dir)).toContain('obsolete.js');

    fs.rmSync(path.join(tree.dir, 'src', 'obsolete.ts'));
    await buildPackage(tree.dir);

    expect(listEmitted(tree.dir)).toStrictEqual(['index.d.ts', 'index.js']);
  });

  it('drops output whose source has since become ignored', async ({ tree }) => {
    // The upgrade path for the packaging defect: a helper emitted by an earlier build has to disappear once
    // the ignore set covers it, which a rebuild that only writes would leave in place.
    scaffoldPackage(tree.dir, {
      'index.ts': 'export const value = 1;\n',
      'test-utils/helper.ts': 'export const helper = 1;\n',
    });
    await buildPackage(tree.dir, { ignorePatterns: [] });
    expect(listEmitted(tree.dir)).toContain('test-utils/helper.js');

    await buildPackage(tree.dir);

    expect(listEmitted(tree.dir)).toStrictEqual(['index.d.ts', 'index.js']);
  });

  // `for` rather than `each`: only `for` hands the fixture context to the case body.
  it.for(['.', '../escape'])('refuses to build into %s and removes nothing', async (outdir, { tree }) => {
    scaffoldPackage(tree.dir, { 'index.ts': 'export const value = 1;\n' });

    await expect(buildPackage(tree.dir, { outdir })).rejects.toThrow(/does not resolve inside the package/);

    expect(fs.existsSync(path.join(tree.dir, 'src', 'index.ts'))).toBe(true);
  });

  it('builds a package with no entry points without touching an absent output directory', async ({ tree }) => {
    scaffoldPackage(tree.dir, { '__tests__/index.test.ts': 'export const covered = 1;\n' });

    await buildPackage(tree.dir);

    expect(fs.existsSync(path.join(tree.dir, 'dist'))).toBe(false);
  });
});

describe('buildPackage atomic publication', () => {
  beforeEach(() => {
    disposeOnTestFinished(silenceConsole(['info']));
  });

  afterEach(() => {
    vi.mocked(ts.createProgram).mockClear();
  });

  it('leaves the previous output intact when the specifier rewrite fails', async ({ tree }) => {
    scaffoldPackage(tree.dir, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(tree.dir);
    const published = readOutput(tree.dir, 'index.js');

    // An alias with no target survives the emit and fails in the rewrite pass, which is the furthest point
    // a build can fail: everything the publish needs has already been produced.
    fs.writeFileSync(
      path.join(tree.dir, 'src', 'index.ts'),
      `import { missing } from '~/nonexistent.ts';\nexport const value = missing;\n`,
    );
    await expect(buildPackage(tree.dir)).rejects.toThrow(/could not resolve aliased import/);

    expect(readOutput(tree.dir, 'index.js')).toBe(published);
  });

  it('leaves the previous output intact when writing the staged output fails', async ({ tree }) => {
    scaffoldPackage(tree.dir, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(tree.dir);
    const published = readOutput(tree.dir, 'index.js');

    fs.writeFileSync(path.join(tree.dir, 'src', 'index.ts'), 'export const value = 2;\n');
    const writeFile = vi.spyOn(ts.sys, 'writeFile').mockImplementationOnce(() => {
      throw new Error('ENOSPC: no space left on device');
    });
    await expect(buildPackage(tree.dir)).rejects.toThrow('ENOSPC');
    writeFile.mockRestore();

    expect(readOutput(tree.dir, 'index.js')).toBe(published);
  });

  it('leaves the previous output intact when the emit reports itself skipped', async ({ tree }) => {
    scaffoldPackage(tree.dir, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(tree.dir);
    const published = readOutput(tree.dir, 'index.js');

    fs.writeFileSync(path.join(tree.dir, 'src', 'index.ts'), 'export const value = 2;\n');
    const compile = vi.mocked(ts.createProgram).getMockImplementation();
    assert(compile !== undefined);
    // A skipped emit is the emit-path failure that lands after the program is complete.
    vi.mocked(ts.createProgram).mockImplementationOnce((...args) => ({
      ...compile(...args),
      emit: () => ({ diagnostics: [], emitSkipped: true }),
    }));
    await expect(buildPackage(tree.dir)).rejects.toThrow(/emit failed/);

    expect(readOutput(tree.dir, 'index.js')).toBe(published);
  });

  it('clears a scratch directory on a build that skips', async ({ tree }) => {
    scaffoldPackage(tree.dir, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(tree.dir);

    const { staging } = resolveScratchDirs(path.join(tree.dir, 'dist', 'esm'));
    fs.mkdirSync(staging, { recursive: true });

    // Inputs are unchanged, so this run never reaches the emit -- the one path with no other sweeper.
    await buildPackage(tree.dir);

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('⏭️'));
    expect(listScratch(tree.dir)).toStrictEqual([]);
  });

  it('clears a scratch directory left behind by a killed run', async ({ tree }) => {
    scaffoldPackage(tree.dir, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(tree.dir);

    const { staging } = resolveScratchDirs(path.join(tree.dir, 'dist', 'esm'));
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(path.join(staging, 'orphan.js'), 'export const orphan = 1;\n');

    fs.writeFileSync(path.join(tree.dir, 'src', 'index.ts'), 'export const value = 2;\n');
    await buildPackage(tree.dir);

    // The orphan is gone rather than published: a fixed scratch name is cleared before use, so nothing
    // accumulates and no sweep has to tell an orphan from a directory another build is still writing.
    expect(listScratch(tree.dir)).toStrictEqual([]);
    expect(listEmitted(tree.dir)).toStrictEqual(['index.d.ts', 'index.js']);
  });
});

describe('buildPackage caching', () => {
  beforeEach(() => {
    disposeOnTestFinished(silenceConsole(['info']));
  });

  afterEach(() => {
    // Clear call history but keep the real default implementation for the next test.
    vi.mocked(ts.createProgram).mockClear();
  });

  it('compiles src to dist/esm', async ({ tree }) => {
    scaffoldPackage(tree.dir, {
      'index.ts': `export { helper } from './helper.ts';\n`,
      'helper.ts': 'export const helper = 1;\n',
    });

    await buildPackage(tree.dir);

    expect(readOutput(tree.dir, 'index.js')).toContain('./helper.js');
  });

  it('writes a cache file and skips an unchanged rebuild', async ({ tree }) => {
    scaffoldPackage(tree.dir, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(tree.dir);
    expect(fs.existsSync(resolveBuildCachePath(tree.dir))).toBe(true);

    // Only the second (unchanged) build logs "No changes detected"; the first logs "Changes detected".
    await buildPackage(tree.dir);

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('No changes detected'));
  });

  // Each row carries the config edits as steps, so the parameterized body applies them without branching on
  // whether a config is present before or after.
  const leaveAbsent: ConfigStep = () => {};
  const writeEmptyConfig: ConfigStep = (configPath) => fs.writeFileSync(configPath, `export default { build: {} };\n`);
  const writeIgnorePatterns: ConfigStep = (configPath) =>
    fs.writeFileSync(configPath, `export default { build: { extraIgnorePatterns: ['**/a/**'] } };\n`);
  const removeConfig: ConfigStep = (configPath) => fs.rmSync(configPath);

  // `for` rather than `each`: only `for` hands the fixture context to the case body, and it passes the case
  // as one argument rather than spreading it.
  it.for([
    ['creating', leaveAbsent, writeIgnorePatterns],
    ['editing', writeEmptyConfig, writeIgnorePatterns],
    ['deleting', writeIgnorePatterns, removeConfig],
  ] as const)('rebuilds after %s the package config', async ([, setUpConfig, changeConfig], { tree }) => {
    const configPath = path.join(tree.dir, '.config', 'nmr.config.ts');
    scaffoldPackage(tree.dir, { 'index.ts': 'export const value = 1;\n' });
    fs.mkdirSync(path.join(tree.dir, '.config'), { recursive: true });
    setUpConfig(configPath);
    await buildPackage(tree.dir);
    vi.mocked(console.info).mockClear();

    changeConfig(configPath);
    await buildPackage(tree.dir);

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('Changes detected'));
  });

  it('writes the cache under node_modules/.cache/nmr-compile, never inside dist', async ({ tree }) => {
    scaffoldPackage(tree.dir, { 'index.ts': 'export const value = 1;\n' });

    await buildPackage(tree.dir);

    const cachePath = resolveBuildCachePath(tree.dir);
    expect(cachePath).toContain(path.join('node_modules', '.cache', 'nmr-compile'));
    expect(fs.existsSync(cachePath)).toBe(true);
    // The regression this guards: the digest must not land inside the published dist tree.
    expect(fs.existsSync(path.join(tree.dir, 'dist', 'esm', '.cache'))).toBe(false);
  });

  it('rebuilds when the output directory has been deleted', async ({ tree }) => {
    scaffoldPackage(tree.dir, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(tree.dir);

    // The reported failure: the cache lives outside `dist`, so wiping the output leaves the digest
    // intact. Skipping here would leave an empty `dist` — and pack an empty tarball — without error.
    fs.rmSync(path.join(tree.dir, 'dist'), { recursive: true, force: true });

    await buildPackage(tree.dir);

    expect(ts.createProgram).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(path.join(tree.dir, 'dist', 'esm', 'index.js'))).toBe(true);
  });

  it('rebuilds when the output directory survives but has been emptied', async ({ tree }) => {
    scaffoldPackage(tree.dir, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(tree.dir);

    // What the old `rimraf dist/*` default did: remove the children, leave the directory standing.
    const outdir = path.join(tree.dir, 'dist', 'esm');
    for (const entry of fs.readdirSync(outdir)) {
      fs.rmSync(path.join(outdir, entry), { recursive: true, force: true });
    }

    await buildPackage(tree.dir);

    expect(ts.createProgram).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(path.join(outdir, 'index.js'))).toBe(true);
  });

  it('reports missing output rather than changed inputs when the output is gone', async ({ tree }) => {
    scaffoldPackage(tree.dir, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(tree.dir);
    fs.rmSync(path.join(tree.dir, 'dist'), { recursive: true, force: true });

    await buildPackage(tree.dir);

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('Build output is missing'));
  });

  it('skips a package whose sources are all declaration files instead of reporting missing output', async ({
    tree,
  }) => {
    // A `.d.ts` file matches the entry glob but emits nothing, so no outdir is ever created. Keying the
    // check on the entry count rather than on what those entries emit rebuilds such a package forever.
    scaffoldPackage(tree.dir, { 'ambient.d.ts': 'export declare const value: number;\n' });
    await buildPackage(tree.dir);

    await buildPackage(tree.dir);

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('No changes detected'));
    expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining('Build output is missing'));
  });

  it('skips a package whose sources are all ignored instead of reporting missing output', async ({ tree }) => {
    // Only a test file, which the default ignore excludes: the package has no entry points, so it
    // emits nothing and its outdir never exists. That absence is not deleted output, and must not be
    // mistaken for it on every subsequent run.
    scaffoldPackage(tree.dir, { '__tests__/index.test.ts': 'export const covered = 1;\n' });
    await buildPackage(tree.dir);

    await buildPackage(tree.dir);

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('No changes detected'));
    expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining('Build output is missing'));
  });

  it('reports the package directory name and 📦 icon when changes are detected', async ({ tree }) => {
    scaffoldPackage(tree.dir, { 'index.ts': 'export const value = 1;\n' });

    await buildPackage(tree.dir);

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('📦'));
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining(path.basename(tree.dir)));
  });

  it('does not write the build cache when the compile fails', async ({ tree }) => {
    scaffoldPackage(tree.dir, { 'index.ts': 'export const value = 1;\n' });
    vi.mocked(ts.createProgram).mockImplementationOnce(() => {
      throw new Error('compile failed');
    });

    await expect(buildPackage(tree.dir)).rejects.toThrow('compile failed');

    expect(fs.existsSync(resolveBuildCachePath(tree.dir))).toBe(false);
  });

  it('re-attempts and rebuilds after a transient compile failure instead of skipping', async ({ tree }) => {
    scaffoldPackage(tree.dir, { 'index.ts': 'export const value = 1;\n' });
    vi.mocked(ts.createProgram).mockImplementationOnce(() => {
      throw new Error('transient failure');
    });
    await expect(buildPackage(tree.dir)).rejects.toThrow('transient failure');

    // Sources are unchanged: a cache poisoned by the failed run would make this skip the compile.
    // Instead it must re-attempt, and with the transient failure gone, produce output and cache it.
    await buildPackage(tree.dir);

    expect(ts.createProgram).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(path.join(tree.dir, 'dist', 'esm', 'index.js'))).toBe(true);
    expect(fs.existsSync(resolveBuildCachePath(tree.dir))).toBe(true);
  });

  it('preserves an existing cache when a changed-source rebuild fails', async ({ tree }) => {
    scaffoldPackage(tree.dir, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(tree.dir);
    const cachePath = resolveBuildCachePath(tree.dir);
    const lastGoodDigest = fs.readFileSync(cachePath, 'utf8');

    // A changed source forces the rebuild to be attempted rather than skipped; make that rebuild fail.
    fs.writeFileSync(path.join(tree.dir, 'src', 'index.ts'), 'export const value = 2;\n');
    vi.mocked(ts.createProgram).mockImplementationOnce(() => {
      throw new Error('rebuild failed');
    });
    await expect(buildPackage(tree.dir)).rejects.toThrow('rebuild failed');

    // The failed rebuild must leave the last successful build's digest intact, not overwrite it.
    expect(fs.readFileSync(cachePath, 'utf8')).toBe(lastGoodDigest);

    // With the failure gone, the next run rebuilds the changed source and refreshes the cache.
    await buildPackage(tree.dir);
    expect(readOutput(tree.dir, 'index.js')).toContain('value = 2');
    expect(fs.readFileSync(cachePath, 'utf8')).not.toBe(lastGoodDigest);
  });
});

describe('buildPackage closing statement', () => {
  beforeEach(() => {
    disposeOnTestFinished(silenceConsole(['info']));
  });

  afterEach(() => {
    vi.mocked(ts.createProgram).mockClear();
  });

  it('closes the build with the count of files it published', async ({ tree }) => {
    // Two sources, each emitting a `.js` and a `.d.ts`.
    scaffoldPackage(tree.dir, {
      'index.ts': `export { helper } from './helper.ts';\n`,
      'helper.ts': 'export const helper = 1;\n',
    });

    await buildPackage(tree.dir);

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('Compiled 4 files to dist/esm.'));
  });

  it('names the resolved outdir rather than the default', async ({ tree }) => {
    scaffoldPackage(tree.dir, { 'index.ts': 'export const value = 1;\n' });

    await buildPackage(tree.dir, { outdir: 'build' });

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('Compiled 2 files to build.'));
  });

  it('closes a package whose entry points emit nothing, which said nothing before', async ({ tree }) => {
    // A `src` tree of declaration files alone is an entry point the compiler emits no output for.
    scaffoldPackage(tree.dir, { 'types.d.ts': 'export type Value = number;\n' });

    await buildPackage(tree.dir);

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('Emitted no output.'));
  });

  it('leaves the skip path to its own conclusion', async ({ tree }) => {
    scaffoldPackage(tree.dir, { 'index.ts': 'export const value = 1;\n' });
    await buildPackage(tree.dir);
    vi.mocked(console.info).mockClear();

    await buildPackage(tree.dir);

    expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining('Compiled'));
  });
});

describe(resolveBuildCachePath, () => {
  it("places the cache in the package's own node_modules when it has one", ({ tree }) => {
    const packageDir = path.join(tree.dir, 'pkg');
    fs.mkdirSync(path.join(packageDir, 'node_modules'), { recursive: true });

    expect(path.dirname(resolveBuildCachePath(packageDir))).toBe(
      path.join(packageDir, 'node_modules', '.cache', 'nmr-compile'),
    );
  });

  it('falls back to the nearest ancestor node_modules for a package that has none', ({ tree }) => {
    // Mirrors a zero-dependency workspace leaf (e.g. nmr-core): with no node_modules of its own, the
    // cache must resolve to a hoisted ancestor rather than a stray directory beside dist.
    fs.mkdirSync(path.join(tree.dir, 'node_modules'), { recursive: true });
    const packageDir = path.join(tree.dir, 'packages', 'leaf');
    fs.mkdirSync(packageDir, { recursive: true });

    expect(path.dirname(resolveBuildCachePath(packageDir))).toBe(
      path.join(tree.dir, 'node_modules', '.cache', 'nmr-compile'),
    );
  });

  it('derives a stable, package-specific key', ({ tree }) => {
    const a = path.join(tree.dir, 'a');
    const b = path.join(tree.dir, 'b');
    fs.mkdirSync(path.join(a, 'node_modules'), { recursive: true });
    fs.mkdirSync(path.join(b, 'node_modules'), { recursive: true });

    expect(resolveBuildCachePath(a)).toBe(resolveBuildCachePath(a));
    expect(resolveBuildCachePath(a)).not.toBe(resolveBuildCachePath(b));
  });

  it('resolves to the path entries already on disk were written under', ({ tree }) => {
    const packageDir = path.join(tree.dir, 'pkg');
    fs.mkdirSync(path.join(packageDir, 'node_modules'), { recursive: true });
    // Spelled out rather than derived from the store, so that a change to how the store keys an entry fails
    // here instead of silently stranding every digest a previous build wrote into a spurious full rebuild.
    const digest = createHash('sha256').update(packageDir).digest('hex').slice(0, 8);

    expect(resolveBuildCachePath(packageDir)).toBe(
      path.join(packageDir, 'node_modules', '.cache', 'nmr-compile', `pkg-${digest}.hash`),
    );
  });
});

// region | Helpers

/** Lists every file under the package's emit directory, as sorted forward-slash paths relative to it. */
function listEmitted(dir: string): string[] {
  const outdir = path.join(dir, 'dist', 'esm');
  if (!fs.existsSync(outdir)) {
    return [];
  }

  return fs
    .readdirSync(outdir, { recursive: true })
    .map(String)
    .filter((entry) => fs.statSync(path.join(outdir, entry)).isFile())
    .map((entry) => entry.split(path.sep).join('/'))
    .toSorted();
}

/** Returns the names of the scratch directories still sitting beside the package's emit directory. */
function listScratch(dir: string): string[] {
  // Listed rather than reached through `Object.values`, whose fixed-key overload yields `any[]`.
  const { previous, staging } = resolveScratchDirs(path.join(dir, 'dist', 'esm'));

  return [previous, staging]
    .filter((scratchDir) => fs.existsSync(scratchDir))
    .map((scratchDir) => path.basename(scratchDir));
}

// endregion | Helpers
