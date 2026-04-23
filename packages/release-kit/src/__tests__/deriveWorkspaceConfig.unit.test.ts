import { afterEach, describe, expect, it, vi } from 'vitest';

const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  readFileSync: mockReadFileSync,
}));

import { deriveWorkspaceConfig } from '../deriveWorkspaceConfig.ts';

describe(deriveWorkspaceConfig, () => {
  afterEach(() => {
    mockReadFileSync.mockReset();
  });

  it('strips the @scope/ prefix from package name to derive tagPrefix', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@williamthorsen/nmr-core' }));

    expect(deriveWorkspaceConfig('packages/core')).toStrictEqual({
      dir: 'core',
      name: '@williamthorsen/nmr-core',
      tagPrefix: 'nmr-core-v',
      workspacePath: 'packages/core',
      packageFiles: ['packages/core/package.json'],
      changelogPaths: ['packages/core'],
      paths: ['packages/core/**'],
    });
  });

  it('uses unscoped package name verbatim when no scope is present', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'readyup' }));

    expect(deriveWorkspaceConfig('packages/readyup')).toStrictEqual({
      dir: 'readyup',
      name: 'readyup',
      tagPrefix: 'readyup-v',
      workspacePath: 'packages/readyup',
      packageFiles: ['packages/readyup/package.json'],
      changelogPaths: ['packages/readyup'],
      paths: ['packages/readyup/**'],
    });
  });

  it('populates name with the full scoped name for later identity comparisons', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@scope/pkg' }));

    expect(deriveWorkspaceConfig('packages/pkg').name).toBe('@scope/pkg');
  });

  it('preserves dir as the basename when the directory name differs from the package name', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@williamthorsen/nmr-core' }));

    const result = deriveWorkspaceConfig('libs/core');

    expect(result.dir).toBe('core');
    expect(result.tagPrefix).toBe('nmr-core-v');
    expect(result.workspacePath).toBe('libs/core');
  });

  it('throws a descriptive error when package.json has no name field', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    expect(() => deriveWorkspaceConfig('packages/bad')).toThrow(
      "packages/bad/package.json is missing a 'name' field (required for tag derivation).",
    );
  });

  it('throws when package.json name field is an empty string', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: '' }));

    expect(() => deriveWorkspaceConfig('packages/empty')).toThrow(
      "packages/empty/package.json is missing a 'name' field (required for tag derivation).",
    );
  });

  it('throws when package.json name field is not a string', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 123 }));

    expect(() => deriveWorkspaceConfig('packages/invalid')).toThrow(
      "packages/invalid/package.json is missing a 'name' field (required for tag derivation).",
    );
  });

  it('wraps readFileSync errors with the workspace path for context', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory, open packages/missing/package.json');
    });

    expect(() => deriveWorkspaceConfig('packages/missing')).toThrow(
      'Failed to read packages/missing/package.json: ENOENT: no such file or directory, open packages/missing/package.json',
    );
  });

  it('wraps JSON.parse errors with the workspace path for context', () => {
    mockReadFileSync.mockReturnValue('not json');

    expect(() => deriveWorkspaceConfig('packages/malformed')).toThrow(
      /^Failed to read packages\/malformed\/package\.json: /,
    );
  });
});
