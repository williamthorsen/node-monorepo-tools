import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  writeFileSync: mockWriteFileSync,
}));

import { writeIfAbsent } from '../scaffold.ts';

describe(writeIfAbsent, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockMkdirSync.mockReset();
    mockWriteFileSync.mockReset();
    vi.restoreAllMocks();
  });

  it('returns "skipped" when file exists and overwrite is false', () => {
    mockExistsSync.mockReturnValue(true);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const result = writeIfAbsent('some/file.ts', 'content', false, false);

    expect(result).toEqual({ action: 'skipped', filePath: 'some/file.ts' });
    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('returns "dry-run" when dryRun is true, regardless of file existence', () => {
    mockExistsSync.mockReturnValue(false);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const result = writeIfAbsent('some/file.ts', 'content', true, false);

    expect(result).toEqual({ action: 'dry-run', filePath: 'some/file.ts' });
    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('returns "dry-run" when file exists but dryRun is true (even with overwrite)', () => {
    mockExistsSync.mockReturnValue(true);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const result = writeIfAbsent('some/file.ts', 'content', true, true);

    expect(result).toEqual({ action: 'dry-run', filePath: 'some/file.ts' });
  });

  it('returns "created" and writes file when file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const result = writeIfAbsent('some/dir/file.ts', 'content', false, false);

    expect(result).toEqual({ action: 'created', filePath: 'some/dir/file.ts' });
    expect(mockMkdirSync).toHaveBeenCalledWith('some/dir', { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalledWith('some/dir/file.ts', 'content', 'utf8');
  });

  it('returns "created" when file exists and overwrite is true', () => {
    mockExistsSync.mockReturnValue(true);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const result = writeIfAbsent('some/file.ts', 'content', false, true);

    expect(result).toEqual({ action: 'created', filePath: 'some/file.ts' });
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it('returns "failed" when mkdirSync throws', () => {
    mockExistsSync.mockReturnValue(false);
    mockMkdirSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = writeIfAbsent('some/file.ts', 'content', false, false);

    expect(result).toEqual({ action: 'failed', filePath: 'some/file.ts' });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('EACCES'));
  });

  it('returns "failed" when writeFileSync throws', () => {
    mockExistsSync.mockReturnValue(false);
    mockWriteFileSync.mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device');
    });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = writeIfAbsent('some/file.ts', 'content', false, false);

    expect(result).toEqual({ action: 'failed', filePath: 'some/file.ts' });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ENOSPC'));
  });
});
