import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { resolveSourceTarget } from '../vitest-source-resolution.ts';

/**
 * A package outside every `node_modules`, reached through a link the way pnpm links a workspace package, and
 * a second one whose real directory sits inside `node_modules`. The pair is what separates the two outcomes:
 * Only the real path distinguishes them, since both are reached by a bare specifier from the same importer.
 */
const TREE_FILES: Record<string, string> = {
  'importer.ts': '',

  'linked/package.json': JSON.stringify({
    name: '@fixture/linked',
    exports: {
      '.': { source: './src/index.ts', default: './dist/index.js' },
      './*': { source: './src/any-*.ts', default: './dist/index.js' },
      './deep/*': { source: './src/deep/*.ts', default: './dist/index.js' },
      './asset': { source: './src/asset.ts', default: './dist/index.js' },
      './directory': { source: './src/directory', default: './dist/index.js' },
      './dual': { browser: { source: './src/browser.ts' }, node: { source: './src/node.ts' } },
      './extensionless': { source: './src/extensionless', default: './dist/index.js' },
      './gone': { source: './src/gone.ts', default: './dist/index.js' },
      './listed': [{ source: './src/listed.ts' }, './dist/index.js'],
      './plain': './dist/index.js',
      './sub': { source: './src/sub.ts', default: './dist/index.js' },
    },
  }),
  'linked/dist/index.js': '',
  'linked/src/any-thing.ts': '',
  'linked/src/asset.ts': '',
  'linked/src/browser.ts': '',
  'linked/src/deep/one.ts': '',
  'linked/src/directory/index.ts': '',
  'linked/src/extensionless.ts': '',
  'linked/src/index.ts': '',
  'linked/src/listed.ts': '',
  'linked/src/node.ts': '',
  'linked/src/sub.ts': '',

  'node_modules/@fixture/inside/package.json': JSON.stringify({
    name: '@fixture/inside',
    exports: { '.': { source: './src/index.ts', default: './dist/index.js' } },
  }),
  'node_modules/@fixture/inside/dist/index.js': '',
  'node_modules/@fixture/inside/src/index.ts': '',

  'unconditioned/package.json': JSON.stringify({ name: 'unconditioned', exports: './dist/index.js' }),
  'unconditioned/dist/index.js': '',

  // A package that imports itself by name, which no `node_modules` entry serves.
  'selfpkg/package.json': JSON.stringify({
    name: '@fixture/selfpkg',
    exports: { '.': { source: './src/index.ts', default: './dist/index.js' } },
  }),
  'selfpkg/dist/index.js': '',
  'selfpkg/src/index.ts': '',
  'selfpkg/src/importer.ts': '',
};

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  { scope: 'file' },
  makeFixture(() => {
    const tree = createTempTree(TREE_FILES, { prefix: 'nmr-source-resolution-' });
    tree.symlink('node_modules/@fixture/linked', tree.resolve('linked'));
    tree.symlink('node_modules/unconditioned', tree.resolve('unconditioned'));

    return tree;
  }),
);

describe(resolveSourceTarget, () => {
  it('resolves a package whose real directory sits outside node_modules', ({ tree }) => {
    expect(resolve(tree, '@fixture/linked')).toBe(tree.resolve('linked/src/index.ts'));
  });

  // The condition reaching this one is the whole defect: Vitest hands the same names to Node, which refuses to
  // strip types from a file under `node_modules`, so every entry there has to resolve without it.
  it('leaves a package whose real directory sits inside node_modules to Vite', ({ tree }) => {
    expect(resolve(tree, '@fixture/inside')).toBeUndefined();
  });

  it('leaves a package declaring no source condition to Vite', ({ tree }) => {
    expect(resolve(tree, 'unconditioned')).toBeUndefined();
  });

  it('leaves a subpath whose entry reaches no source condition to Vite', ({ tree }) => {
    expect(resolve(tree, '@fixture/linked/plain')).toBeUndefined();
  });

  it('resolves a subpath export', ({ tree }) => {
    expect(resolve(tree, '@fixture/linked/sub')).toBe(tree.resolve('linked/src/sub.ts'));
  });

  // Node picks the pattern with the longest base rather than the first that matches, and both patterns here match:
  // Taking `./*` would resolve a file that the package does not hold.
  it('resolves a pattern export, preferring the longest matching base', ({ tree }) => {
    expect(resolve(tree, '@fixture/linked/deep/one')).toBe(tree.resolve('linked/src/deep/one.ts'));
    expect(resolve(tree, '@fixture/linked/thing')).toBe(tree.resolve('linked/src/any-thing.ts'));
  });

  it('resolves a source condition nested under the resolving environment', ({ tree }) => {
    expect(resolve(tree, '@fixture/linked/dual')).toBe(tree.resolve('linked/src/node.ts'));
    expect(resolve(tree, '@fixture/linked/dual', 'client')).toBe(tree.resolve('linked/src/browser.ts'));
  });

  it('resolves the first entry of an array that reaches a source condition', ({ tree }) => {
    expect(resolve(tree, '@fixture/linked/listed')).toBe(tree.resolve('linked/src/listed.ts'));
  });

  // Falling through to the build output is what nothing in a run reports, and what resolving from source exists
  // to prevent.
  it('rejects a source condition that reaches no file', ({ tree }) => {
    expect(() => resolve(tree, '@fixture/linked/gone')).toThrow(
      /@fixture\/linked.*"\.\/gone".*"\.\/src\/gone\.ts".*reaches no file/s,
    );
  });

  it.for(['./sibling.ts', '/absolute/path.ts', '\0virtual:module', 'node:path', 'path'])(
    'leaves %s to Vite',
    (specifier, { expect, tree }) => {
      expect(resolve(tree, specifier)).toBeUndefined();
    },
  );

  it('leaves a specifier naming no installed package to Vite', ({ tree }) => {
    expect(resolve(tree, '@fixture/absent')).toBeUndefined();
  });

  // Vite reads a self-reference off the importer's own manifest, so no `node_modules` entry serves this import and
  // the walk alone would decline it, leaving the suite to run against the package's build output.
  it('resolves a package that imports itself by name', ({ tree }) => {
    const importer = tree.resolve('selfpkg/src/importer.ts');

    expect(resolveSourceTarget('@fixture/selfpkg', importer, { environmentName: 'ssr' })).toBe(
      tree.resolve('selfpkg/src/index.ts'),
    );
  });

  // Vite looks the subpath up without the suffix and re-appends it, so carrying the suffix into the `exports` map
  // would expand a `*` pattern into a path that nobody wrote.
  it('resolves a subpath carrying a query suffix, and keeps the suffix', ({ tree }) => {
    expect(resolve(tree, '@fixture/linked/asset?raw')).toBe(`${tree.resolve('linked/src/asset.ts')}?raw`);
    expect(resolve(tree, '@fixture/linked/thing?raw')).toBe(`${tree.resolve('linked/src/any-thing.ts')}?raw`);
  });

  it('resolves a subpath carrying a hash suffix, and keeps the suffix', ({ tree }) => {
    expect(resolve(tree, '@fixture/linked/asset#frag')).toBe(`${tree.resolve('linked/src/asset.ts')}#frag`);
  });

  // `source` is a bundler condition that Node never reads, so a package may point it where only Vite's own
  // extension and index resolution reaches.
  it('resolves a target that names a file only under an extension', ({ tree }) => {
    expect(resolve(tree, '@fixture/linked/extensionless')).toBe(tree.resolve('linked/src/extensionless.ts'));
  });

  it('resolves a target that names a directory holding an index', ({ tree }) => {
    expect(resolve(tree, '@fixture/linked/directory')).toBe(tree.resolve('linked/src/directory/index.ts'));
  });

  // The environment decides which branch of a dual-target `exports` map is taken, and a run reaches the client
  // branch only under browser mode, which no suite here runs. Vitest names its environments `client` and `ssr`;
  // a release renaming either would take the wrong branch here with every suite still green.
  it.for([
    ['client', 'linked/src/browser.ts'],
    ['ssr', 'linked/src/node.ts'],
    ['__vitest_vm__', 'linked/src/node.ts'],
  ] as const)('resolves the %s environment through its own condition', ([environment, expected], { expect, tree }) => {
    expect(resolve(tree, '@fixture/linked/dual', environment)).toBe(tree.resolve(expected));
  });

  it('declines where there is no importer to resolve from', () => {
    expect(resolveSourceTarget('@fixture/linked', undefined, { environmentName: 'ssr' })).toBeUndefined();
  });
});

// region | Helpers

/** Resolves one specifier from a file at the tree's root, as the named environment. */
function resolve(tree: TempTree, specifier: string, environmentName = 'ssr'): string | undefined {
  return resolveSourceTarget(specifier, tree.resolve('importer.ts'), { environmentName });
}

// endregion | Helpers
