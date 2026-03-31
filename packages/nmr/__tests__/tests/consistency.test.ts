import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getNodeVersionFromAction,
  getPnpmVersionFromAction,
  getPnpmVersionFromPackageJson,
} from '../../src/tests/consistency.ts';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-consistency-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true });
});

/** Write a file inside `tmpDir`, creating parent directories as needed. */
function writeFixture(relativePath: string, content: string): void {
  const fullPath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

/** Create a minimal code-quality action YAML with the given version fields. */
function writeActionYaml(options: { nodeVersion?: string; pnpmVersion?: string }): void {
  const lines = ['jobs:', '  code-quality:', '    with:'];
  if (options.pnpmVersion !== undefined) {
    lines.push(`      pnpm-version: "${options.pnpmVersion}"`);
  }
  if (options.nodeVersion !== undefined) {
    lines.push(`      node-version: "${options.nodeVersion}"`);
  }
  writeFixture('.github/workflows/code-quality.yaml', lines.join('\n') + '\n');
}

describe('getPnpmVersionFromPackageJson', () => {
  it('extracts the version from a valid packageManager field', () => {
    writeFixture('package.json', JSON.stringify({ packageManager: 'pnpm@9.15.4' }));

    expect(getPnpmVersionFromPackageJson(tmpDir)).toBe('9.15.4');
  });

  it('throws when packageManager names a different manager', () => {
    writeFixture('package.json', JSON.stringify({ packageManager: 'npm@10.0.0' }));

    expect(() => getPnpmVersionFromPackageJson(tmpDir)).toThrow('packageManager is not pnpm');
  });

  it('throws when packageManager has no version after @', () => {
    writeFixture('package.json', JSON.stringify({ packageManager: 'pnpm@' }));

    expect(() => getPnpmVersionFromPackageJson(tmpDir)).toThrow('pnpm version missing');
  });

  it('throws when packageManager is not a string', () => {
    writeFixture('package.json', JSON.stringify({ packageManager: 123 }));

    expect(() => getPnpmVersionFromPackageJson(tmpDir)).toThrow('"packageManager" field missing or not a string');
  });

  it('throws when packageManager field is missing', () => {
    writeFixture('package.json', JSON.stringify({ name: 'test' }));

    expect(() => getPnpmVersionFromPackageJson(tmpDir)).toThrow('Missing key');
  });
});

describe('getPnpmVersionFromAction', () => {
  it('reads pnpm-version from the action YAML', async () => {
    writeActionYaml({ pnpmVersion: '9.15.4' });

    await expect(getPnpmVersionFromAction(tmpDir)).resolves.toBe('9.15.4');
  });

  it('throws when the action file is missing', async () => {
    await expect(getPnpmVersionFromAction(tmpDir)).rejects.toThrow();
  });
});

describe('getNodeVersionFromAction', () => {
  it('reads node-version from the action YAML', async () => {
    writeActionYaml({ nodeVersion: '22.14.0' });

    await expect(getNodeVersionFromAction(tmpDir)).resolves.toBe('22.14.0');
  });

  it('throws when the action file is missing', async () => {
    await expect(getNodeVersionFromAction(tmpDir)).rejects.toThrow();
  });
});
