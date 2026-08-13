import { silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  readFileSync: mockReadFileSync,
}));

import { readCurrentVersion } from '../readCurrentVersion.ts';

describe(readCurrentVersion, () => {
  afterEach(() => {
    mockReadFileSync.mockReset();
  });

  it('returns the version field when package.json parses successfully', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '1.2.3' }));

    expect(readCurrentVersion('package.json')).toBe('1.2.3');
  });

  it('returns undefined when package.json has no version field', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg' }));
    using silent = silenceConsole(['warn']);

    expect(readCurrentVersion('package.json')).toBeUndefined();
    expect(silent.warn).not.toHaveBeenCalled();
  });

  it('returns undefined and warns when the file cannot be read', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file');
    });
    using silent = silenceConsole(['warn']);

    expect(readCurrentVersion('missing.json')).toBeUndefined();
    expect(silent.warn).toHaveBeenCalledWith(expect.stringContaining('missing.json'));
    expect(silent.warn).toHaveBeenCalledWith(expect.stringContaining('ENOENT'));
  });

  it('returns undefined and warns when the file is not valid JSON', () => {
    mockReadFileSync.mockReturnValue('not json');
    using silent = silenceConsole(['warn']);

    expect(readCurrentVersion('bad.json')).toBeUndefined();
    expect(silent.warn).toHaveBeenCalledWith(expect.stringContaining('bad.json'));
  });
});
