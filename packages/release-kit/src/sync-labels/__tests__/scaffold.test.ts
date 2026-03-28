import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeFileWithCheck } from '@williamthorsen/node-monorepo-core';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

describe(writeFileWithCheck, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockMkdirSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    vi.restoreAllMocks();
  });

  it('returns "skipped" when file exists and overwrite is false', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('different content');

    const result = writeFileWithCheck('some/file.ts', 'content', { dryRun: false, overwrite: false });

    expect(result).toEqual({ outcome: 'skipped', filePath: 'some/file.ts' });
    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('returns "created" in dry-run mode when file does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    const result = writeFileWithCheck('some/file.ts', 'content', { dryRun: true, overwrite: false });

    expect(result).toEqual({ outcome: 'created', filePath: 'some/file.ts' });
    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('returns "overwritten" in dry-run mode when file exists and overwrite is true', () => {
    mockExistsSync.mockReturnValue(true);

    const result = writeFileWithCheck('some/file.ts', 'content', { dryRun: true, overwrite: true });

    expect(result).toEqual({ outcome: 'overwritten', filePath: 'some/file.ts' });
  });

  it('returns "created" and writes file when file does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    const result = writeFileWithCheck('some/dir/file.ts', 'content', { dryRun: false, overwrite: false });

    expect(result).toEqual({ outcome: 'created', filePath: 'some/dir/file.ts' });
    expect(mockMkdirSync).toHaveBeenCalledWith('some/dir', { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalledWith('some/dir/file.ts', 'content', 'utf8');
  });

  it('returns "overwritten" when file exists and overwrite is true', () => {
    mockExistsSync.mockReturnValue(true);

    const result = writeFileWithCheck('some/file.ts', 'content', { dryRun: false, overwrite: true });

    expect(result).toEqual({ outcome: 'overwritten', filePath: 'some/file.ts' });
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it('returns "up-to-date" when file exists with matching content', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('content');

    const result = writeFileWithCheck('some/file.ts', 'content', { dryRun: false, overwrite: false });

    expect(result).toEqual({ outcome: 'up-to-date', filePath: 'some/file.ts' });
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('returns "failed" when mkdirSync throws', () => {
    mockExistsSync.mockReturnValue(false);
    mockMkdirSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    const result = writeFileWithCheck('some/file.ts', 'content', { dryRun: false, overwrite: false });

    expect(result).toEqual({ outcome: 'failed', filePath: 'some/file.ts' });
  });

  it('returns "failed" when writeFileSync throws', () => {
    mockExistsSync.mockReturnValue(false);
    mockWriteFileSync.mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device');
    });

    const result = writeFileWithCheck('some/file.ts', 'content', { dryRun: false, overwrite: false });

    expect(result).toEqual({ outcome: 'failed', filePath: 'some/file.ts' });
  });
});
