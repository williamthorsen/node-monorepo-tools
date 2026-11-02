import { describe, expect, it } from 'vitest';

import { findMissingManifestPaths } from '../findMissingManifestPaths.ts';

describe(findMissingManifestPaths, () => {
  it('returns nothing for a manifest that does not declare any entry field', () => {
    expect(findMissingManifestPaths({ name: 'bare' }, ['package.json'], [])).toStrictEqual([]);
  });

  describe('main', () => {
    it.each([
      ['an exact path', './dist/index.js', ['dist/index.js']],
      ['a path without an extension', './dist/index', ['dist/index.js']],
      ['a JSON path without an extension', 'data', ['data.json']],
      ['a directory', './dist', ['dist/index.js']],
      ['the package root', '.', ['index.js']],
    ])('accepts %s', (_description, main, packedFiles) => {
      expect(findMissingManifestPaths({ main }, packedFiles, [])).toStrictEqual([]);
    });

    it('reports a main that resolves to no packed file', () => {
      expect(findMissingManifestPaths({ main: './dist/index.js' }, ['package.json'], [])).toStrictEqual([
        { location: 'main', path: './dist/index.js' },
      ]);
    });
  });

  it('reports a missing types file', () => {
    expect(findMissingManifestPaths({ types: './dist/index.d.ts' }, ['dist/index.js'], [])).toStrictEqual([
      { location: 'types', path: './dist/index.d.ts' },
    ]);
  });

  describe('bin', () => {
    it('checks a string bin', () => {
      expect(findMissingManifestPaths({ bin: './bin/cli.js' }, [], [])).toStrictEqual([
        { location: 'bin', path: './bin/cli.js' },
      ]);
    });

    it('checks each command of a bin map', () => {
      const manifest = { bin: { present: 'bin/present.js', absent: 'bin/absent.js' } };

      expect(findMissingManifestPaths(manifest, ['bin/present.js'], [])).toStrictEqual([
        { location: 'bin.absent', path: 'bin/absent.js' },
      ]);
    });
  });

  describe('exports', () => {
    it('checks a string export', () => {
      expect(findMissingManifestPaths({ exports: './dist/index.js' }, [], [])).toStrictEqual([
        { location: 'exports', path: './dist/index.js' },
      ]);
    });

    it('checks every nested condition under each subpath', () => {
      const manifest = {
        exports: {
          '.': { types: './dist/index.d.ts', import: './dist/index.js' },
          './config': { node: { import: './dist/config.js' }, default: './dist/config.cjs' },
        },
      };

      expect(findMissingManifestPaths(manifest, ['dist/index.d.ts', 'dist/config.cjs'], [])).toStrictEqual([
        { location: 'exports["."].import', path: './dist/index.js' },
        { location: 'exports["./config"].node.import', path: './dist/config.js' },
      ]);
    });

    it('checks conditions declared at the top of exports', () => {
      expect(findMissingManifestPaths({ exports: { import: './index.js' } }, [], [])).toStrictEqual([
        { location: 'exports.import', path: './index.js' },
      ]);
    });

    it('locates each element of an array target', () => {
      const manifest = { exports: { '.': ['./dist/a.js', './dist/b.js'] } };

      expect(findMissingManifestPaths(manifest, ['dist/a.js'], [])).toStrictEqual([
        { location: 'exports["."][1]', path: './dist/b.js' },
      ]);
    });

    it('skips a null target', () => {
      expect(findMissingManifestPaths({ exports: { './internal/*': null } }, [], [])).toStrictEqual([]);
    });

    it('accepts a subpath pattern that matches a nested packed file', () => {
      const manifest = { exports: { './features/*': './dist/features/*.js' } };

      expect(findMissingManifestPaths(manifest, ['dist/features/deep/one.js'], [])).toStrictEqual([]);
    });

    it('reports a subpath pattern that matches no packed file', () => {
      const manifest = { exports: { './features/*': './dist/features/*.js' } };

      expect(findMissingManifestPaths(manifest, ['dist/other/one.js'], [])).toStrictEqual([
        { location: 'exports["./features/*"]', path: './dist/features/*.js' },
      ]);
    });

    it('exempts the source condition and every configured condition, with their subtrees', () => {
      const manifest = {
        exports: {
          '.': { source: './src/index.ts', 'nmr-source': { import: './src/index.ts' }, default: './dist/index.js' },
        },
      };

      expect(findMissingManifestPaths(manifest, ['dist/index.js'], ['nmr-source'])).toStrictEqual([]);
    });

    it('checks a condition that the repo does not declare as a development condition', () => {
      const manifest = { exports: { '.': { 'nmr-source': './src/index.ts' } } };

      expect(findMissingManifestPaths(manifest, [], [])).toStrictEqual([
        { location: 'exports["."].nmr-source', path: './src/index.ts' },
      ]);
    });
  });
});
