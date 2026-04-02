import { describe, expect, it, vi } from 'vitest';

const mockUnlinkSync = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  unlinkSync: mockUnlinkSync,
}));

import { deleteFileIfExists } from '../deleteFileIfExists.ts';

describe(deleteFileIfExists, () => {
  it('deletes the file at the given path', () => {
    deleteFileIfExists('/tmp/some-file');

    expect(mockUnlinkSync).toHaveBeenCalledWith('/tmp/some-file');
  });

  it('silently returns when the file does not exist', () => {
    mockUnlinkSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    expect(() => deleteFileIfExists('/tmp/missing')).not.toThrow();
  });

  it('re-throws non-ENOENT errors', () => {
    mockUnlinkSync.mockImplementation(() => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    });

    expect(() => deleteFileIfExists('/tmp/protected')).toThrow('EACCES');
  });
});
