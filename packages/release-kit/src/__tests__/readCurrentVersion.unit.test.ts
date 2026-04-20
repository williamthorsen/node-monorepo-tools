import { afterEach, describe, expect, it, vi } from 'vitest';

const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  readFileSync: mockReadFileSync,
}));

import { readCurrentVersion } from '../readCurrentVersion.ts';

describe(readCurrentVersion, () => {
  afterEach(() => {
    mockReadFileSync.mockReset();
    vi.restoreAllMocks();
  });

  it('returns the version field when package.json parses successfully', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '1.2.3' }));

    expect(readCurrentVersion('package.json')).toBe('1.2.3');
  });

  it('returns undefined when package.json has no version field', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg' }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(readCurrentVersion('package.json')).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns undefined and warns when the file cannot be read', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(readCurrentVersion('missing.json')).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing.json'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ENOENT'));
  });

  it('returns undefined and warns when the file is not valid JSON', () => {
    mockReadFileSync.mockReturnValue('not json');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(readCurrentVersion('bad.json')).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('bad.json'));
  });
});
