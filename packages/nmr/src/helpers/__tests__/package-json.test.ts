import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hasPublishableEntryPoint, readPackageJson } from '../package-json.ts';

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
