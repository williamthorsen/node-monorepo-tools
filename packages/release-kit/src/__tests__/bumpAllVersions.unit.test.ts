import { afterEach, describe, expect, it, vi } from 'vitest';

const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

import { bumpAllVersions } from '../bumpAllVersions.ts';

describe(bumpAllVersions, () => {
  afterEach(() => {
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    vi.restoreAllMocks();
  });

  it('reads the first file only once when packageFiles has a single entry', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '1.0.0' }));

    bumpAllVersions(['packages/a/package.json'], 'patch', false);

    expect(mockReadFileSync).toHaveBeenCalledTimes(1);
    expect(mockReadFileSync).toHaveBeenCalledWith('packages/a/package.json', 'utf8');
  });

  it('reads each additional file exactly once without re-reading the first', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
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

    // First file is read once (before the loop). The loop reuses it for the first entry,
    // so only two additional reads for b and c.
    expect(mockReadFileSync).toHaveBeenCalledTimes(3);
    expect(mockReadFileSync).toHaveBeenCalledWith('packages/a/package.json', 'utf8');
    expect(mockReadFileSync).toHaveBeenCalledWith('packages/b/package.json', 'utf8');
    expect(mockReadFileSync).toHaveBeenCalledWith('packages/c/package.json', 'utf8');
  });

  it('writes the bumped version to all files', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '1.2.3' }));

    const result = bumpAllVersions(['packages/a/package.json', 'packages/b/package.json'], 'patch', false);

    expect(result).toBe('1.2.4');
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
    vi.spyOn(console, 'info').mockImplementation(() => {});
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '0.5.0' }));

    const result = bumpAllVersions(['packages/a/package.json'], 'major', true);

    expect(result).toBe('1.0.0');
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('throws when no package files are specified', () => {
    expect(() => bumpAllVersions([], 'patch', false)).toThrow('No package files specified');
  });
});
