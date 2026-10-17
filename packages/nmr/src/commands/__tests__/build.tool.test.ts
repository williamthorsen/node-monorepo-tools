import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished, makeFixture, silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import * as ts from 'typescript';
import { afterEach, assert, beforeEach, describe, expect, it as baseIt, vi } from 'vitest';

import { buildPackage } from '../build.ts';
import {
  collectPrograms,
  countBuilds,
  listEmitted,
  readOutput,
  scaffoldPackage,
} from '../test-utils/build-fixtures.ts';

// Default the compiler API to the real implementation so that the regression suite compiles for real;
// the cache-integrity tests override createProgram per-call to simulate a failing or transient compile.
vi.mock(import('typescript'), async (importOriginal) => {
  const actual = await importOriginal();
  // Attach the implementation after construction. Passing it to `vi.fn` would infer the overloaded signature of
  // `createProgram`, and `Mock<T>` collapses an overload set to its last member, which the module's shape rejects.
  const createProgram = vi.fn();
  createProgram.mockImplementation(actual.createProgram);
  return { ...actual, createProgram };
});

/** A source containing one comment of every kind whose survival the emit decides. */
const COMMENTED_SOURCE = `/*! @license Fixture 1.0 */

/** Adds two numbers. */
export function add(a: number, b: number): number {
  // Sum before returning.
  return a + b;
}

export function swallow(): void {
  try {
    add(1, 2);
  } catch {
    // Nothing to do when the addition throws.
  }
}

/** A scope. */
export interface Scope {
  /** The root-level option. */
  root?: string;
}
`;

const it = baseIt
  // eslint-disable-next-line no-empty-pattern -- Vitest parses a fixture's first parameter and rejects anything but a destructuring pattern.
  .extend('builtPackage', { scope: 'file' }, async ({}, { onCleanup }) => {
    using stack = new DisposableStack();
    const tree = stack.use(createTempTree({}, { prefix: 'nmr-build-regression-' }));
    scaffoldPackage(tree, {
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

    // Silence the console for the compile alone. A file-scoped silencer would hand its call history to every later
    // per-test spy, which is what the caching block's negative `console.info` assertions read.
    {
      using _silent = silenceConsole(['info']);
      await buildPackage(tree.dir, { style: 'rich' });
    }

    const ownedStack = stack.move();
    onCleanup(() => {
      ownedStack.dispose();
    });

    return tree;
  })
  .extend(
    'tree',
    makeFixture(() => createTempTree({}, { prefix: 'nmr-build-' })),
  );

describe('buildPackage regression suite', () => {
  it('rewrites a dynamic import() specifier to .js in the emitted .js', ({ builtPackage }) => {
    expect(readOutput(builtPackage, 'index.js')).toMatch(/import\(["']\.\/dyn\.js["']\)/);
  });

  it('rewrites a dynamic import() type specifier to .js in the emitted .d.ts', ({ builtPackage }) => {
    expect(readOutput(builtPackage, 'index.d.ts')).toMatch(/import\(["']\.\/dyn\.js["']\)/);
  });

  it('rewrites a bare side-effect import to .js in both outputs', ({ builtPackage }) => {
    expect(readOutput(builtPackage, 'index.js')).toMatch(/import ["']\.\/side\.js["']/);
    expect(readOutput(builtPackage, 'index.d.ts')).toMatch(/import ["']\.\/side\.js["']/);
  });

  it('leaves a .ts specifier inside a string literal untouched in both outputs', ({ builtPackage }) => {
    expect(readOutput(builtPackage, 'index.js')).toContain(`import x from './decoy.ts'`);
    expect(readOutput(builtPackage, 'index.d.ts')).toContain(`import x from './decoy.ts'`);
  });

  it('rewrites a tsconfig paths alias to a relative .js specifier in both outputs', ({ builtPackage }) => {
    const js = readOutput(builtPackage, 'index.js');
    const dts = readOutput(builtPackage, 'index.d.ts');
    expect(js).toMatch(/from ["']\.\/helper\.js["']/);
    expect(js).not.toContain('~/');
    expect(dts).toMatch(/from ["']\.\/helper\.js["']/);
    expect(dts).not.toContain('~/');
  });

  it('resolves an alias relative to the importing file in a nested directory in both outputs', ({ builtPackage }) => {
    expect(readOutput(builtPackage, 'nested/leaf.js')).toMatch(/from ["']\.\.\/helper\.js["']/);
    expect(readOutput(builtPackage, 'nested/leaf.d.ts')).toMatch(/from ["']\.\.\/helper\.js["']/);
  });

  it('rewrites a re-export specifier to .js in both outputs', ({ builtPackage }) => {
    expect(readOutput(builtPackage, 'index.js')).toMatch(/from ["']\.\/reexport\.js["']/);
    expect(readOutput(builtPackage, 'index.d.ts')).toMatch(/from ["']\.\/reexport\.js["']/);
  });
});

describe('buildPackage emit correctness', () => {
  beforeEach(() => {
    disposeOnTestFinished(silenceConsole(['info']));
  });

  afterEach(() => {
    vi.mocked(ts.createProgram).mockClear();
  });

  it('parses each source once across the two programs', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });

    await buildPackage(tree.dir, { style: 'rich' });

    // Object identity is the only reliable signal: `structureIsReused` reports the module resolutions alone,
    // and reads `2` whether or not the source files are shared. The whole set is asserted because the `lib.*`
    // files outnumber the package's own sources 63 to 1 here and account for nearly all of the avoided parse.
    const [scriptProgram, declarationProgram] = collectPrograms();
    assert(scriptProgram !== undefined && declarationProgram !== undefined);
    const reparsedFileNames = scriptProgram
      .getSourceFiles()
      .filter((sourceFile) => declarationProgram.getSourceFile(sourceFile.fileName) !== sourceFile)
      .map((sourceFile) => sourceFile.fileName);

    expect(reparsedFileNames).toStrictEqual([]);
  });

  it('throws when an aliased import resolves to a missing file', async ({ tree }) => {
    scaffoldPackage(tree, {
      'index.ts': `import { missing } from '~/nonexistent.ts';\nexport const value = missing;\n`,
    });

    await expect(buildPackage(tree.dir, { style: 'rich' })).rejects.toThrow(
      /could not resolve aliased import '~\/nonexistent\.ts'/,
    );
  });

  it('emits declaration files under outDir even when tsconfig sets declarationDir', async ({ tree }) => {
    scaffoldPackage(
      tree,
      {
        'helper.ts': 'export const helper = 1;\nexport type Thing = { n: number };\n',
        'index.ts': `import { helper, type Thing } from '~/helper.ts';\nexport const value: Thing = { n: helper };\n`,
      },
      { declarationDir: './types' },
    );

    await buildPackage(tree.dir, { style: 'rich' });

    expect(tree.exists('dist/esm/index.d.ts')).toBe(true);
    expect(tree.exists('types/index.d.ts')).toBe(false);
    expect(readOutput(tree, 'index.d.ts')).toMatch(/from ["']\.\/helper\.js["']/);
  });

  it('rejects when the resolved TypeScript version is older than the supported floor', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });

    // `ts.versionMajorMinor` is typed as the literal installed version; alias to a widened view so
    // that the spy can return an older value. Force it below the >=5.7 floor and restore in
    // finally to keep the override from leaking into sibling tests.
    const tsModule: { versionMajorMinor: string } = ts;
    const versionSpy = vi.spyOn(tsModule, 'versionMajorMinor', 'get').mockReturnValue('5.6');
    try {
      await expect(buildPackage(tree.dir, { style: 'rich' })).rejects.toThrow(/requires TypeScript >=5\.7/);
    } finally {
      versionSpy.mockRestore();
    }
  });

  it('rejects a TypeScript whose major is at or above the supported ceiling, naming the range', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n' });

    // The same widened view as the floor case, so that the spy can return a version above the ceiling.
    const tsModule: { versionMajorMinor: string } = ts;
    const versionSpy = vi.spyOn(tsModule, 'versionMajorMinor', 'get').mockReturnValue('7.0');
    try {
      await expect(buildPackage(tree.dir, { style: 'rich' })).rejects.toThrow(/requires TypeScript >=5\.7 <7/);
    } finally {
      versionSpy.mockRestore();
    }
  });

  it('rewrites an inline import-type alias to a relative .js specifier in the emitted .d.ts', async ({ tree }) => {
    scaffoldPackage(tree, {
      'helper.ts': 'export type Thing = { n: number };\n',
      'index.ts': `export type Wrapped = { value: import('~/helper.ts').Thing };\n`,
    });

    await buildPackage(tree.dir, { style: 'rich' });

    const declaration = readOutput(tree, 'index.d.ts');
    expect(declaration).toMatch(/import\(["']\.\/helper\.js["']\)\.Thing/);
    expect(declaration).not.toContain('~/helper.ts');
    expect(declaration).not.toContain('./helper.ts');
  });
});

describe('buildPackage comment retention', () => {
  beforeEach(() => {
    disposeOnTestFinished(silenceConsole(['info']));
  });

  afterEach(() => {
    vi.mocked(ts.createProgram).mockClear();
  });

  it('keeps doc comments in the declarations emitted by a comment-stripping package', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': COMMENTED_SOURCE }, { removeComments: true });

    await buildPackage(tree.dir, { style: 'rich' });

    const declaration = readOutput(tree, 'index.d.ts');
    expect(declaration).toContain('/** Adds two numbers. */');
    expect(declaration).toContain('/** The root-level option. */');
  });

  it('strips every script comment but the license banner when the package sets removeComments', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': COMMENTED_SOURCE }, { removeComments: true });

    await buildPackage(tree.dir, { style: 'rich' });

    const script = readOutput(tree, 'index.js');
    expect(script).toContain('/*! @license Fixture 1.0 */');
    expect(script).not.toContain('/** Adds two numbers. */');
    expect(script).not.toContain('Sum before returning');
    // A comment alone in an empty block does not attach to any node in the emitted tree.
    expect(script).not.toContain('Nothing to do when the addition throws');
  });

  it('keeps script comments when the package leaves removeComments unset', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': COMMENTED_SOURCE });

    await buildPackage(tree.dir, { style: 'rich' });

    expect(readOutput(tree, 'index.js')).toContain('/** Adds two numbers. */');
    expect(readOutput(tree, 'index.js')).toContain('Sum before returning');
    expect(readOutput(tree, 'index.d.ts')).toContain('/** Adds two numbers. */');
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
    const packageDir = scaffoldExtendedBasePackage(tree);

    await buildPackage(packageDir, { style: 'rich' });

    const js = tree.read('pkg/dist/esm/index.js');
    const dts = tree.read('pkg/dist/esm/index.d.ts');
    expect(js).toMatch(/from ["']\.\/helper\.js["']/);
    expect(js).not.toContain('~/');
    expect(dts).toMatch(/from ["']\.\/helper\.js["']/);
    expect(dts).not.toContain('~/');
  });

  it('resolves a base-config-inherited alias relative to a nested importing file', async ({ tree }) => {
    const packageDir = scaffoldExtendedBasePackage(tree);

    await buildPackage(packageDir, { style: 'rich' });

    expect(tree.read('pkg/dist/esm/nested/leaf.js')).toMatch(/from ["']\.\.\/helper\.js["']/);
  });

  it('rebuilds when a base config in the extends chain changes', async ({ tree }) => {
    const packageDir = scaffoldExtendedBasePackage(tree);
    await buildPackage(packageDir, { style: 'rich' });

    // Change only the base config; the package's own tsconfig and sources stay byte-identical, so a
    // cache that ignored the extends chain would skip this rebuild and leave stale output in place.
    tree.write('tsconfig.base.json', tree.read('tsconfig.base.json').replace('"ES2022"', '"ES2021"'));

    await buildPackage(packageDir, { style: 'rich' });

    expect(countBuilds()).toBe(2);
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
    const packageDir = scaffoldRootEscapingAliasPackage(tree);

    await expect(buildPackage(packageDir, { style: 'rich' })).rejects.toThrow(
      /aliased import '~\/rootFile\.ts' from .* resolves to .*rootFile\.ts/,
    );
  });

  it('fails the build when an escaping alias resolves only through baseUrl, which Node ignores', async ({ tree }) => {
    // `packages/foo/src/x.ts` is reachable through `baseUrl`, so a fallback that stripped only `paths`
    // would resolve it and emit it verbatim, and then Node, ignoring `baseUrl`, throws at runtime.
    const packageDir = scaffoldBaseUrlReachableEscapingAliasPackage(tree);

    await expect(buildPackage(packageDir, { style: 'rich' })).rejects.toThrow(
      /aliased import 'packages\/foo\/src\/x\.ts' from .* resolves to .*x\.ts/,
    );
  });

  it('emits verbatim when an alias-prefix-matched specifier resolves outside src but bare-resolves', async ({
    tree,
  }) => {
    // A `paths` key `lodash` collides (via `startsWith`) with an innocent `lodash-es` import, a real
    // installed package outside `src/`. It resolves the same with or without `paths`, so it is genuinely
    // external and runtime-runnable, and the build must emit it verbatim rather than fail.
    scaffoldPackage(
      tree,
      { 'index.ts': `import { merge } from 'lodash-es';\nexport const value = merge;\n` },
      { paths: { lodash: ['./src/lodash-shim.ts'] } },
    );
    tree.writeAll({
      'node_modules/lodash-es/index.d.ts': 'export declare const merge: number;\n',
      'node_modules/lodash-es/index.js': 'export const merge = 1;\n',
      'node_modules/lodash-es/package.json': JSON.stringify({
        name: 'lodash-es',
        version: '1.0.0',
        type: 'module',
        main: './index.js',
        types: './index.d.ts',
      }),
    });

    await buildPackage(tree.dir, { style: 'rich' });

    expect(readOutput(tree, 'index.js')).toMatch(/from ["']lodash-es["']/);
  });
});

describe('buildPackage entry-point selection', () => {
  beforeEach(() => {
    disposeOnTestFinished(silenceConsole(['info']));
  });

  afterEach(() => {
    vi.mocked(ts.createProgram).mockClear();
  });

  // `for` rather than `each`: Only `for` hands the fixture context to the case body.
  it.for(['__fixtures__', '__mocks__', '__tests__', 'test-utils'])(
    'excludes %s/ from the default entry points',
    async (directory, { tree }) => {
      scaffoldPackage(tree, {
        'index.ts': 'export const value = 1;\n',
        [`${directory}/helper.ts`]: 'export const helper = 1;\n',
      });

      await buildPackage(tree.dir, { style: 'rich' });

      expect(listEmitted(tree)).toStrictEqual(['index.d.ts', 'index.js']);
    },
  );

  it('emits a helper that production code imports, despite the ignore', async ({ tree }) => {
    // The ignore selects entry points; the compiler still emits whatever they reach. Suppressing a reachable
    // file would leave index.js importing a specifier that was never written.
    scaffoldPackage(tree, {
      'index.ts': `import { helper } from './test-utils/helper.ts';\nexport const value = helper;\n`,
      'test-utils/helper.ts': 'export const helper = 1;\n',
    });

    await buildPackage(tree.dir, { style: 'rich' });

    expect(listEmitted(tree)).toContain('test-utils/helper.js');
  });

  it('replaces the default ignore set when given `ignorePatterns`', async ({ tree }) => {
    scaffoldPackage(tree, {
      'index.ts': 'export const value = 1;\n',
      'test-utils/helper.ts': 'export const helper = 1;\n',
    });

    await buildPackage(tree.dir, { style: 'rich', ignorePatterns: [] });

    expect(listEmitted(tree)).toContain('test-utils/helper.js');
  });

  it('adds to the effective ignore set when given `extraIgnorePatterns`', async ({ tree }) => {
    scaffoldPackage(tree, {
      'index.ts': 'export const value = 1;\n',
      'internal/helper.ts': 'export const helper = 1;\n',
    });

    await buildPackage(tree.dir, { style: 'rich', extraIgnorePatterns: ['**/internal/**'] });

    expect(listEmitted(tree)).toStrictEqual(['index.d.ts', 'index.js']);
  });

  it('composes `extraIgnorePatterns` onto an `ignorePatterns` override rather than onto the default', async ({
    tree,
  }) => {
    scaffoldPackage(tree, {
      'index.ts': 'export const value = 1;\n',
      'internal/helper.ts': 'export const helper = 1;\n',
      'test-utils/helper.ts': 'export const helper = 1;\n',
    });

    // `ignorePatterns: []` drops the defaults, so test-utils/ returns as an entry point; the extras apply on top.
    await buildPackage(tree.dir, { style: 'rich', ignorePatterns: [], extraIgnorePatterns: ['**/internal/**'] });

    expect(listEmitted(tree)).toStrictEqual([
      'index.d.ts',
      'index.js',
      'test-utils/helper.d.ts',
      'test-utils/helper.js',
    ]);
  });
});

describe('buildPackage with .tsx sources', () => {
  beforeEach(() => {
    disposeOnTestFinished(silenceConsole(['info']));
  });

  afterEach(() => {
    vi.mocked(ts.createProgram).mockClear();
  });

  // The fixture does not install React, so the JSX type-checks with errors; emit does not depend on type checking.
  const VIEW_SOURCE = 'export function View(): unknown {\n  return <div />;\n}\n';

  it('emits .js and .d.ts for a .tsx entry point that nothing imports', async ({ tree }) => {
    scaffoldPackage(tree, { 'index.ts': 'export const value = 1;\n', 'view.tsx': VIEW_SOURCE }, { jsx: 'react-jsx' });

    await buildPackage(tree.dir, { style: 'rich' });

    expect(listEmitted(tree)).toStrictEqual(['index.d.ts', 'index.js', 'view.d.ts', 'view.js']);
  });

  it('compiles JSX with the transform that the package tsconfig names', async ({ tree }) => {
    scaffoldPackage(tree, { 'view.tsx': VIEW_SOURCE }, { jsx: 'react-jsx' });

    await buildPackage(tree.dir, { style: 'rich' });

    expect(readOutput(tree, 'view.js')).toMatch(/from ["']react\/jsx-runtime["']/);
  });

  it('rewrites a relative .tsx specifier to .js once in both outputs', async ({ tree }) => {
    scaffoldPackage(
      tree,
      { 'index.ts': `export { View } from './view.tsx';\n`, 'view.tsx': VIEW_SOURCE },
      { jsx: 'react-jsx' },
    );

    await buildPackage(tree.dir, { style: 'rich' });

    for (const output of ['index.js', 'index.d.ts']) {
      expect(readOutput(tree, output)).toMatch(/from ["']\.\/view\.js["']/);
    }
  });

  it('rewrites an alias that resolves to a .tsx file, imported from a nested .tsx file', async ({ tree }) => {
    scaffoldPackage(
      tree,
      {
        'nested/panel.tsx': `import { View } from '~/view.tsx';\nexport function Panel(): unknown {\n  return <View />;\n}\n`,
        'view.tsx': VIEW_SOURCE,
      },
      { jsx: 'react-jsx' },
    );

    await buildPackage(tree.dir, { style: 'rich' });

    expect(readOutput(tree, 'nested/panel.js')).toMatch(/from ["']\.\.\/view\.js["']/);
    expect(readOutput(tree, 'nested/panel.js')).not.toContain('~/');
  });
});

// region | Helpers

/**
 * Writes a package under `rootDir/pkg` whose inherited alias maps `packages/*` to a sibling `packages/`
 * tree, so `import 'packages/foo/src/x.ts'` escapes the package's `src/`. Because the target is reachable
 * through the inherited `baseUrl` as well, a fallback that emulated the runtime by stripping only `paths`
 * would still resolve it and emit it verbatim; yet Node, which honors neither `baseUrl` nor `paths`,
 * cannot load the bare specifier at runtime.
 */
function scaffoldBaseUrlReachableEscapingAliasPackage(tree: TempTree): string {
  tree.writeAll({
    'packages/foo/src/x.ts': 'export const x = 1;\n',
    'pkg/node_modules/': '',
    'pkg/package.json': JSON.stringify({ name: 'fixture', type: 'module' }),
    'pkg/src/index.ts': `import { x } from 'packages/foo/src/x.ts';\nexport const value = x;\n`,
    'pkg/tsconfig.json': JSON.stringify({ extends: '../tsconfig.base.json', include: ['src/'] }),
    'tsconfig.base.json': JSON.stringify({
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
  });

  return tree.resolve('pkg');
}

/**
 * Writes a package under `rootDir/pkg` whose own tsconfig does not declare `paths`; instead it
 * `extends` a base config in the parent directory that supplies `baseUrl` and `paths`. This mirrors
 * the real package layout (every package inherits `paths` from the repo-root config), in which
 * TypeScript anchors inherited `paths` to the base config's directory rather than the leaf's.
 */
function scaffoldExtendedBasePackage(tree: TempTree): string {
  tree.writeAll({
    'pkg/node_modules/': '',
    'pkg/package.json': JSON.stringify({ name: 'fixture', type: 'module' }),
    'pkg/src/helper.ts': 'export const helper = 1;\nexport type Thing = { n: number };\n',
    'pkg/src/index.ts': `import { helper, type Thing } from '~/helper.ts';\nexport const value: Thing = { n: helper };\n`,
    'pkg/src/nested/leaf.ts': `import { helper } from '~/helper.ts';\nexport const leaf = helper;\n`,
    'pkg/tsconfig.json': JSON.stringify({ extends: '../tsconfig.base.json', include: ['src/'] }),
    'tsconfig.base.json': JSON.stringify({
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
  });

  return tree.resolve('pkg');
}

/**
 * Writes a package under `rootDir/pkg` whose inherited `~/*` alias is anchored at `rootDir` and maps to
 * `rootDir` itself, so an import of `~/rootFile.ts` resolves to a file above the package's `src/`. Because
 * Node never sees `paths`, the emitted specifier is unresolvable at runtime.
 */
function scaffoldRootEscapingAliasPackage(tree: TempTree): string {
  tree.writeAll({
    'pkg/node_modules/': '',
    'pkg/package.json': JSON.stringify({ name: 'fixture', type: 'module' }),
    'pkg/src/index.ts': `import { rootValue } from '~/rootFile.ts';\nexport const value = rootValue;\n`,
    'pkg/tsconfig.json': JSON.stringify({ extends: '../tsconfig.base.json', include: ['src/'] }),
    'rootFile.ts': 'export const rootValue = 1;\n',
    'tsconfig.base.json': JSON.stringify({
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
  });

  return tree.resolve('pkg');
}

// endregion | Helpers
