import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readPackageVersion } from '../src/readPackageVersion.ts';

describe(readPackageVersion, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'readPackageVersion-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the version string from the nearest ancestor package.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.2.3' }));
    const calleeFile = path.join(tmpDir, 'src', 'callee.ts');
    fs.mkdirSync(path.dirname(calleeFile), { recursive: true });

    expect(readPackageVersion(pathToFileURL(calleeFile).href)).toBe('1.2.3');
  });

  it('walks up multiple directory levels to find package.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'fixture', version: '4.5.6' }));
    const deepFile = path.join(tmpDir, 'a', 'b', 'c', 'd', 'callee.ts');
    fs.mkdirSync(path.dirname(deepFile), { recursive: true });

    expect(readPackageVersion(pathToFileURL(deepFile).href)).toBe('4.5.6');
  });

  it('throws when the located package.json has no version field', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'fixture' }));
    const calleeFile = path.join(tmpDir, 'callee.ts');

    expect(() => readPackageVersion(pathToFileURL(calleeFile).href)).toThrow(
      /No string "version" field in .*package\.json/,
    );
  });

  it('throws when the located package.json has a non-string version field', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'fixture', version: 42 }));
    const calleeFile = path.join(tmpDir, 'callee.ts');

    expect(() => readPackageVersion(pathToFileURL(calleeFile).href)).toThrow(
      /No string "version" field in .*package\.json/,
    );
  });

  it('includes the resolved package.json path in the error message', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'fixture' }));
    const calleeFile = path.join(tmpDir, 'callee.ts');
    const expectedPath = path.join(tmpDir, 'package.json');

    expect(() => readPackageVersion(pathToFileURL(calleeFile).href)).toThrow(expectedPath);
  });
});
