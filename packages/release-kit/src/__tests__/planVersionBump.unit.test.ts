import { afterEach, describe, expect, it, vi } from 'vitest';

const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

import { planVersionBump, planVersionSet } from '../planVersionBump.ts';

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

  it('preserves the underlying error as the cause when a package file cannot be read', () => {
    const underlying = new Error('EACCES: permission denied');
    mockReadFileSync.mockImplementation(() => {
      throw underlying;
    });

    expect(() => planVersionBump(['packages/a/package.json'], 'minor')).toThrow(
      expect.objectContaining({ cause: underlying }),
    );
  });

  it('preserves the underlying error as the cause when a package file holds invalid JSON', () => {
    mockReadFileSync.mockReturnValue('{ not valid json');

    expect(() => planVersionBump(['packages/a/package.json'], 'minor')).toThrow(
      expect.objectContaining({ cause: expect.any(SyntaxError) }),
    );
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
