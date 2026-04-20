import { afterEach, describe, expect, it, vi } from 'vitest';

const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  readFileSync: mockReadFileSync,
}));

import { component } from '../component.ts';

describe(component, () => {
  afterEach(() => {
    mockReadFileSync.mockReset();
  });

  it('strips the @scope/ prefix from package name to derive tagPrefix', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@williamthorsen/node-monorepo-core' }));

    expect(component('packages/core')).toStrictEqual({
      dir: 'core',
      tagPrefix: 'node-monorepo-core-v',
      workspacePath: 'packages/core',
      packageFiles: ['packages/core/package.json'],
      changelogPaths: ['packages/core'],
      paths: ['packages/core/**'],
    });
  });

  it('uses unscoped package name verbatim when no scope is present', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'readyup' }));

    expect(component('packages/readyup')).toStrictEqual({
      dir: 'readyup',
      tagPrefix: 'readyup-v',
      workspacePath: 'packages/readyup',
      packageFiles: ['packages/readyup/package.json'],
      changelogPaths: ['packages/readyup'],
      paths: ['packages/readyup/**'],
    });
  });

  it('preserves dir as the basename when the directory name differs from the package name', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@williamthorsen/node-monorepo-core' }));

    const result = component('libs/core');

    expect(result.dir).toBe('core');
    expect(result.tagPrefix).toBe('node-monorepo-core-v');
    expect(result.workspacePath).toBe('libs/core');
  });

  it('throws a descriptive error when package.json has no name field', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    expect(() => component('packages/bad')).toThrow(
      "packages/bad/package.json is missing a 'name' field (required for tag derivation).",
    );
  });

  it('throws when package.json name field is an empty string', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: '' }));

    expect(() => component('packages/empty')).toThrow(
      "packages/empty/package.json is missing a 'name' field (required for tag derivation).",
    );
  });

  it('throws when package.json name field is not a string', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 123 }));

    expect(() => component('packages/invalid')).toThrow(
      "packages/invalid/package.json is missing a 'name' field (required for tag derivation).",
    );
  });

  it('propagates the underlying error when readFileSync fails (e.g., missing file)', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory, open packages/missing/package.json');
    });

    expect(() => component('packages/missing')).toThrow('ENOENT');
  });

  it('throws a SyntaxError when package.json contents are not valid JSON', () => {
    mockReadFileSync.mockReturnValue('not json');

    expect(() => component('packages/malformed')).toThrow(SyntaxError);
  });
});
