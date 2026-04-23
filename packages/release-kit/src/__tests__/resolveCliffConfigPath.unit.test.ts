import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockFindPackageRoot = vi.hoisted(() => vi.fn().mockReturnValue('/fake'));

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
}));

vi.mock(import('@williamthorsen/nmr-core'), () => ({
  findPackageRoot: mockFindPackageRoot,
}));

import { resolveCliffConfigPath } from '../resolveCliffConfigPath.ts';

describe(resolveCliffConfigPath, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockFindPackageRoot.mockReset().mockReturnValue('/fake');
  });

  it('returns the explicit path when cliffConfigPath is provided', () => {
    const result = resolveCliffConfigPath('custom/cliff.toml', 'file:///fake/src/resolveCliffConfigPath.ts');

    expect(result).toBe('custom/cliff.toml');
    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  it('returns .config/git-cliff.toml when it exists', () => {
    mockExistsSync.mockImplementation((path: string) => path === '.config/git-cliff.toml');

    const result = resolveCliffConfigPath(undefined, 'file:///fake/src/resolveCliffConfigPath.ts');

    expect(result).toBe('.config/git-cliff.toml');
  });

  it('returns cliff.toml when .config/git-cliff.toml does not exist', () => {
    mockExistsSync.mockImplementation((path: string) => path === 'cliff.toml');

    const result = resolveCliffConfigPath(undefined, 'file:///fake/src/resolveCliffConfigPath.ts');

    expect(result).toBe('cliff.toml');
  });

  it('returns the bundled template path when no local config exists', () => {
    // Convention candidates don't exist; bundled template does.
    mockExistsSync.mockImplementation((path: string) => path.endsWith('cliff.toml.template'));

    const result = resolveCliffConfigPath(undefined, 'file:///fake/src/resolveCliffConfigPath.ts');

    expect(result).toBe('/fake/cliff.toml.template');
  });

  it('throws when no config file can be found', () => {
    mockExistsSync.mockReturnValue(false);

    expect(() => resolveCliffConfigPath(undefined, 'file:///fake/src/resolveCliffConfigPath.ts')).toThrow(
      'Could not resolve a git-cliff config file',
    );
  });

  it('prefers .config/git-cliff.toml over cliff.toml when both exist', () => {
    mockExistsSync.mockReturnValue(true);

    const result = resolveCliffConfigPath(undefined, 'file:///fake/src/resolveCliffConfigPath.ts');

    expect(result).toBe('.config/git-cliff.toml');
  });
});
