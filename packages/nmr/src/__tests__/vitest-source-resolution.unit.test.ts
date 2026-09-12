import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { resolveSourceTarget } from '../vitest-source-resolution.ts';

/**
 * A package outside every `node_modules`, reached through a link the way pnpm links a workspace package, and a
 * second one whose real directory sits inside `node_modules`. The pair is what separates the two outcomes: only
 * the real path distinguishes them, since both are reached by a bare specifier from the same importer.
 */
const TREE_FILES: Record<string, string> = {
  'importer.ts': '',

  'linked/package.json': JSON.stringify({
    name: '@fixture/linked',
    exports: {
      '.': { source: './src/index.ts', default: './dist/index.js' },
      './*': { source: './src/any-*.ts', default: './dist/index.js' },
      './deep/*': { source: './src/deep/*.ts', default: './dist/index.js' },
      './dual': { browser: { source: './src/browser.ts' }, node: { source: './src/node.ts' } },
      './gone': { source: './src/gone.ts', default: './dist/index.js' },
      './listed': [{ source: './src/listed.ts' }, './dist/index.js'],
      './plain': './dist/index.js',
      './sub': { source: './src/sub.ts', default: './dist/index.js' },
    },
  }),
  'linked/dist/index.js': '',
  'linked/src/any-thing.ts': '',
  'linked/src/browser.ts': '',
  'linked/src/deep/one.ts': '',
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

  // Node picks the pattern with the longest base rather than the first that matches, and both patterns here
  // match: taking `./*` would resolve a file that the package does not hold.
  it('resolves a pattern export, preferring the longest matching base', ({ tree }) => {
    expect(resolve(tree, '@fixture/linked/deep/one')).toBe(tree.resolve('linked/src/deep/one.ts'));
    expect(resolve(tree, '@fixture/linked/thing')).toBe(tree.resolve('linked/src/any-thing.ts'));
  });

  it('resolves a source condition nested under the resolving environment', ({ tree }) => {
    expect(resolve(tree, '@fixture/linked/dual')).toBe(tree.resolve('linked/src/node.ts'));
    expect(resolve(tree, '@fixture/linked/dual', 'browser')).toBe(tree.resolve('linked/src/browser.ts'));
  });

  it('resolves the first entry of an array that reaches a source condition', ({ tree }) => {
    expect(resolve(tree, '@fixture/linked/listed')).toBe(tree.resolve('linked/src/listed.ts'));
  });

  // Falling through to the build output is what nothing in a run reports, and what resolving from source exists
  // to prevent.
  it('rejects a source condition naming a file the package does not hold', ({ tree }) => {
    expect(() => resolve(tree, '@fixture/linked/gone')).toThrow(
      /@fixture\/linked.*"\.\/gone".*"\.\/src\/gone\.ts".*does not exist/s,
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
});

// region | Helpers

/** Resolves one specifier from a file at the tree's root, through the environment's condition. */
function resolve(tree: TempTree, specifier: string, environmentCondition = 'node'): string | undefined {
  return resolveSourceTarget(specifier, tree.resolve('importer.ts'), { environmentCondition });
}

// endregion | Helpers
