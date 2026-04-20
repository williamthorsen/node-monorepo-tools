import { afterEach, describe, expect, it, vi } from 'vitest';

const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

import { bumpAllVersions, setAllVersions } from '../bumpAllVersions.ts';

describe(bumpAllVersions, () => {
  afterEach(() => {
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    vi.restoreAllMocks();
  });

  it('reads the first file only once when packageFiles has a single entry', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '1.0.0' }));

    bumpAllVersions(['packages/a/package.json'], 'patch', false);

    expect(mockReadFileSync).toHaveBeenCalledTimes(1);
    expect(mockReadFileSync).toHaveBeenCalledWith('packages/a/package.json', 'utf8');
  });

  it('reads each additional file exactly once without re-reading the first', () => {
    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath === 'packages/a/package.json') {
        return JSON.stringify({ name: 'a', version: '2.1.0' });
      }
      if (filePath === 'packages/b/package.json') {
        return JSON.stringify({ name: 'b', version: '2.1.0' });
      }
      if (filePath === 'packages/c/package.json') {
        return JSON.stringify({ name: 'c', version: '2.1.0' });
      }
      throw new Error(`Unexpected read: ${filePath}`);
    });

    bumpAllVersions(['packages/a/package.json', 'packages/b/package.json', 'packages/c/package.json'], 'minor', false);

    // One read per file: the first file is read before the loop and reused inside it.
    expect(mockReadFileSync).toHaveBeenCalledTimes(3);
    expect(mockReadFileSync).toHaveBeenCalledWith('packages/a/package.json', 'utf8');
    expect(mockReadFileSync).toHaveBeenCalledWith('packages/b/package.json', 'utf8');
    expect(mockReadFileSync).toHaveBeenCalledWith('packages/c/package.json', 'utf8');
  });

  it('returns a BumpResult with currentVersion, newVersion, and files', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '1.2.3' }));

    const result = bumpAllVersions(['packages/a/package.json', 'packages/b/package.json'], 'patch', false);

    expect(result).toStrictEqual({
      currentVersion: '1.2.3',
      newVersion: '1.2.4',
      files: ['packages/a/package.json', 'packages/b/package.json'],
    });
  });

  it('writes the bumped version to all files', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '1.2.3' }));

    bumpAllVersions(['packages/a/package.json', 'packages/b/package.json'], 'patch', false);

    expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
    expect(mockWriteFileSync).toHaveBeenNthCalledWith(
      1,
      'packages/a/package.json',
      expect.stringContaining('"version": "1.2.4"'),
      'utf8',
    );
    expect(mockWriteFileSync).toHaveBeenNthCalledWith(
      2,
      'packages/b/package.json',
      expect.stringContaining('"version": "1.2.4"'),
      'utf8',
    );
  });

  it('skips writing in dry-run mode', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '0.5.0' }));

    const result = bumpAllVersions(['packages/a/package.json'], 'major', true);

    // Pre-1.0 'major' collapses to a minor bump, so 0.5.0 → 0.6.0 (not 1.0.0).
    expect(result.newVersion).toBe('0.6.0');
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('throws when no package files are specified', () => {
    expect(() => bumpAllVersions([], 'patch', false)).toThrow('No package files specified');
  });
});

describe(setAllVersions, () => {
  afterEach(() => {
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    vi.restoreAllMocks();
  });

  it('writes the provided version to every file and returns the pre-write current version', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '0.5.0' }));

    const result = setAllVersions(['packages/a/package.json', 'packages/b/package.json'], '1.0.0', false);

    expect(result).toStrictEqual({
      currentVersion: '0.5.0',
      newVersion: '1.0.0',
      files: ['packages/a/package.json', 'packages/b/package.json'],
    });
    expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
    expect(mockWriteFileSync).toHaveBeenNthCalledWith(
      1,
      'packages/a/package.json',
      expect.stringContaining('"version": "1.0.0"'),
      'utf8',
    );
    expect(mockWriteFileSync).toHaveBeenNthCalledWith(
      2,
      'packages/b/package.json',
      expect.stringContaining('"version": "1.0.0"'),
      'utf8',
    );
  });

  it('does not write files in dry-run mode', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '0.5.0' }));

    const result = setAllVersions(['packages/a/package.json'], '1.0.0', true);

    expect(result.currentVersion).toBe('0.5.0');
    expect(result.newVersion).toBe('1.0.0');
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('throws when no package files are specified', () => {
    expect(() => setAllVersions([], '1.0.0', false)).toThrow('No package files specified');
  });
});
