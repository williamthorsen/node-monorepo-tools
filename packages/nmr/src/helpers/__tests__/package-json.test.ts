import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readPackageJson } from '../package-json.ts';

describe(readPackageJson, () => {
  let dir: string;

  function writeManifest(content: unknown): void {
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify(content));
  }

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'nmr-pkgjson-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('parses the fields nmr reads', () => {
    writeManifest({
      name: 'p',
      private: true,
      version: '1.2.3',
      packageManager: 'pnpm@10.34.4',
      scripts: { build: 'tsc' },
      pnpm: { overrides: { lodash: '4.17.21' } },
    });

    expect(readPackageJson(dir)).toStrictEqual({
      name: 'p',
      private: true,
      version: '1.2.3',
      packageManager: 'pnpm@10.34.4',
      scripts: { build: 'tsc' },
      pnpm: { overrides: { lodash: '4.17.21' } },
    });
  });

  it('omits fields the manifest does not declare', () => {
    writeManifest({ name: 'p' });

    expect(readPackageJson(dir)).toStrictEqual({ name: 'p' });
  });

  it('omits a field whose value is of the wrong type', () => {
    writeManifest({ name: 42, version: '1.0.0' });

    expect(readPackageJson(dir)).toStrictEqual({ version: '1.0.0' });
  });

  it('drops a non-string script rather than the whole scripts map', () => {
    writeManifest({ scripts: { build: 'tsc', broken: 7 } });

    expect(readPackageJson(dir)).toStrictEqual({ scripts: { build: 'tsc' } });
  });

  it('treats "private": false as not private', () => {
    writeManifest({ name: 'p', private: false });

    expect(readPackageJson(dir)).toStrictEqual({ name: 'p' });
  });

  it('throws when the manifest is not an object', () => {
    writeFileSync(path.join(dir, 'package.json'), '"not an object"');

    expect(() => readPackageJson(dir)).toThrow(TypeError);
  });

  it('throws when the manifest is not valid JSON', () => {
    writeFileSync(path.join(dir, 'package.json'), '{ not json');

    expect(() => readPackageJson(dir)).toThrow();
  });
});
