import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getDeclaredTypesPaths, hasPublishableEntryPoint, readPackageJson } from '../package-json.ts';

describe(hasPublishableEntryPoint, () => {
  it('returns false when neither main nor exports is declared', () => {
    expect(hasPublishableEntryPoint({})).toBe(false);
  });

  it('returns true when only main is declared', () => {
    expect(hasPublishableEntryPoint({ main: './index.js' })).toBe(true);
  });

  it('returns true when exports is declared as an object', () => {
    expect(hasPublishableEntryPoint({ exports: { '.': './index.js' } })).toBe(true);
  });

  it('returns true when exports is declared as a string', () => {
    expect(hasPublishableEntryPoint({ exports: './index.js' })).toBe(true);
  });

  it('returns true when both main and exports are declared', () => {
    expect(hasPublishableEntryPoint({ main: './index.js', exports: { '.': './index.js' } })).toBe(true);
  });
});

describe(getDeclaredTypesPaths, () => {
  it('returns nothing for a package that makes no type claim', () => {
    expect(getDeclaredTypesPaths({ exports: { '.': './index.js' } })).toStrictEqual([]);
  });

  it('collects a top-level types field', () => {
    expect(getDeclaredTypesPaths({ types: './index.d.ts' })).toStrictEqual(['./index.d.ts']);
  });

  it('collects the legacy typings field', () => {
    expect(getDeclaredTypesPaths({ typings: './index.d.ts' })).toStrictEqual(['./index.d.ts']);
  });

  it('collects a types condition in exports', () => {
    const pkg = { exports: { '.': { types: './index.d.ts', import: './index.js' } } };

    expect(getDeclaredTypesPaths(pkg)).toStrictEqual(['./index.d.ts']);
  });

  it('collects a types condition nested under another condition', () => {
    const pkg = { exports: { '.': { import: { types: './index.d.mts', default: './index.mjs' } } } };

    expect(getDeclaredTypesPaths(pkg)).toStrictEqual(['./index.d.mts']);
  });

  it('collects a types condition that itself branches by condition', () => {
    const pkg = { exports: { '.': { types: { import: './index.d.mts', require: './index.d.cts' } } } };

    expect(getDeclaredTypesPaths(pkg)).toStrictEqual(['./index.d.mts', './index.d.cts']);
  });

  it('collects a types condition from every subpath', () => {
    const pkg = {
      exports: {
        '.': { types: './index.d.ts', default: './index.js' },
        './sub': { types: './sub.d.ts', default: './sub.js' },
      },
    };

    expect(getDeclaredTypesPaths(pkg)).toStrictEqual(['./index.d.ts', './sub.d.ts']);
  });

  it('collects each alternative of an array target', () => {
    const pkg = { exports: { '.': { types: ['./a.d.ts', './b.d.ts'] } } };

    expect(getDeclaredTypesPaths(pkg)).toStrictEqual(['./a.d.ts', './b.d.ts']);
  });

  it('collects a types condition from a fallback array of subpath targets', () => {
    const pkg = { exports: { '.': [{ types: './a.d.ts', default: './a.js' }, './a.js'] } };

    expect(getDeclaredTypesPaths(pkg)).toStrictEqual(['./a.d.ts']);
  });

  it('treats a "./types" subpath as a subpath, not a types condition', () => {
    const pkg = { exports: { './types': './dist/types.js' } };

    expect(getDeclaredTypesPaths(pkg)).toStrictEqual([]);
  });

  it('ignores a withdrawn subpath declared as null', () => {
    const pkg = { exports: { '.': { types: './index.d.ts' }, './internal': null } };

    expect(getDeclaredTypesPaths(pkg)).toStrictEqual(['./index.d.ts']);
  });

  it('deduplicates a path claimed more than once', () => {
    const pkg = { types: './index.d.ts', exports: { '.': { types: './index.d.ts', default: './index.js' } } };

    expect(getDeclaredTypesPaths(pkg)).toStrictEqual(['./index.d.ts']);
  });
});

describe(readPackageJson, () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'nmr-pkgjson-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('parses main and exports fields', () => {
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'p', main: './index.js', exports: { '.': './index.js' } }),
    );

    const pkg = readPackageJson(dir);

    expect(pkg.main).toBe('./index.js');
    expect(pkg.exports).toStrictEqual({ '.': './index.js' });
    expect(hasPublishableEntryPoint(pkg)).toBe(true);
  });

  it('reports no entry point for a bin-only package', () => {
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', bin: { p: './cli.js' } }));

    expect(hasPublishableEntryPoint(readPackageJson(dir))).toBe(false);
  });
});
