import { afterEach, describe, expect, it, vi } from 'vitest';

const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

import { bumpAllVersions, planVersionBump, planVersionSet, setAllVersions } from '../bumpAllVersions.ts';

describe(planVersionBump, () => {
  afterEach(() => {
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
  });

  it('returns the version read from the first file and the version derived from the release type', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '1.2.3' }));

    const plan = planVersionBump(['packages/a/package.json'], 'minor');

    expect(plan.currentVersion).toBe('1.2.3');
    expect(plan.newVersion).toBe('1.3.0');
  });

  it('renders the file with two-space indentation and a trailing newline', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '1.0.0' }));

    const plan = planVersionBump(['packages/a/package.json'], 'minor');

    expect(plan.writes).toStrictEqual([
      { path: 'packages/a/package.json', content: '{\n  "name": "pkg",\n  "version": "1.1.0"\n}\n' },
    ]);
  });

  it('renders one write per package file, each carrying the new version', () => {
    mockReadFileSync.mockImplementation((filePath: string) => JSON.stringify({ name: filePath, version: '2.1.0' }));

    const plan = planVersionBump(['packages/a/package.json', 'packages/b/package.json'], 'patch');

    expect(plan.writes.map((write) => write.path)).toStrictEqual([
      'packages/a/package.json',
      'packages/b/package.json',
    ]);
    for (const write of plan.writes) {
      expect(write.content).toContain('"version": "2.1.1"');
    }
  });

  it('writes nothing', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '1.0.0' }));

    planVersionBump(['packages/a/package.json'], 'major');

    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('throws when no package files are specified', () => {
    expect(() => planVersionBump([], 'patch')).toThrow('No package files specified');
  });
});

describe(planVersionSet, () => {
  afterEach(() => {
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
  });

  it('returns the version read from the first file alongside the requested version', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '0.5.0' }));

    const plan = planVersionSet(['packages/a/package.json'], '1.0.0');

    expect(plan.currentVersion).toBe('0.5.0');
    expect(plan.newVersion).toBe('1.0.0');
  });

  it('renders the requested version into every package file', () => {
    mockReadFileSync.mockImplementation((filePath: string) => JSON.stringify({ name: filePath, version: '0.5.0' }));

    const plan = planVersionSet(['packages/a/package.json', 'packages/b/package.json'], '1.0.0');

    for (const write of plan.writes) {
      expect(write.content).toContain('"version": "1.0.0"');
    }
  });

  it('writes nothing', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '0.5.0' }));

    planVersionSet(['packages/a/package.json'], '1.0.0');

    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('throws when no package files are specified', () => {
    expect(() => planVersionSet([], '1.0.0')).toThrow('No package files specified');
  });
});

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
