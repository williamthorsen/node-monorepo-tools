import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeFileWithCheck } from '../src/writeFileWithCheck.ts';

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
  });

  describe('created outcome', () => {
    it('creates a new file and returns "created"', () => {
      mockExistsSync.mockReturnValue(false);

      const result = writeFileWithCheck('some/dir/file.ts', 'content', { dryRun: false, overwrite: false });

      expect(result).toEqual({ filePath: 'some/dir/file.ts', outcome: 'created' });
      expect(mockMkdirSync).toHaveBeenCalledWith('some/dir', { recursive: true });
      expect(mockWriteFileSync).toHaveBeenCalledWith('some/dir/file.ts', 'content', 'utf8');
    });
  });

  describe('overwritten outcome', () => {
    it('overwrites an existing file when overwrite is true', () => {
      mockExistsSync.mockReturnValue(true);

      const result = writeFileWithCheck('some/file.ts', 'new content', { dryRun: false, overwrite: true });

      expect(result).toEqual({ filePath: 'some/file.ts', outcome: 'overwritten' });
      expect(mockWriteFileSync).toHaveBeenCalledWith('some/file.ts', 'new content', 'utf8');
    });
  });

  describe('up-to-date outcome', () => {
    it('returns "up-to-date" when existing content matches', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('same content');

      const result = writeFileWithCheck('some/file.ts', 'same content', { dryRun: false, overwrite: false });

      expect(result).toEqual({ filePath: 'some/file.ts', outcome: 'up-to-date' });
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('treats files as matching when they differ only in trailing whitespace', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('line one  \nline two  \n\n');

      const result = writeFileWithCheck('some/file.ts', 'line one\nline two\n', { dryRun: false, overwrite: false });

      expect(result).toEqual({ filePath: 'some/file.ts', outcome: 'up-to-date' });
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });
  });

  describe('skipped outcome', () => {
    it('returns "skipped" when file exists with different content and overwrite is false', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('different content');

      const result = writeFileWithCheck('some/file.ts', 'new content', { dryRun: false, overwrite: false });

      expect(result).toEqual({ filePath: 'some/file.ts', outcome: 'skipped' });
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('returns "skipped" when reading existing file throws and overwrite is false', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      const result = writeFileWithCheck('some/file.ts', 'content', { dryRun: false, overwrite: false });

      expect(result).toEqual({ filePath: 'some/file.ts', outcome: 'skipped' });
    });
  });

  describe('failed outcome', () => {
    it('returns "failed" when mkdirSync throws', () => {
      mockExistsSync.mockReturnValue(false);
      mockMkdirSync.mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      const result = writeFileWithCheck('some/file.ts', 'content', { dryRun: false, overwrite: false });

      expect(result).toEqual({ filePath: 'some/file.ts', outcome: 'failed' });
    });

    it('returns "failed" when writeFileSync throws', () => {
      mockExistsSync.mockReturnValue(false);
      mockWriteFileSync.mockImplementation(() => {
        throw new Error('ENOSPC: no space left on device');
      });

      const result = writeFileWithCheck('some/file.ts', 'content', { dryRun: false, overwrite: false });

      expect(result).toEqual({ filePath: 'some/file.ts', outcome: 'failed' });
    });
  });

  describe('dry-run mode', () => {
    it('returns "created" without writing when file does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      const result = writeFileWithCheck('some/file.ts', 'content', { dryRun: true, overwrite: false });

      expect(result).toEqual({ filePath: 'some/file.ts', outcome: 'created' });
      expect(mockMkdirSync).not.toHaveBeenCalled();
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('returns "overwritten" without writing when file exists and overwrite is true', () => {
      mockExistsSync.mockReturnValue(true);

      const result = writeFileWithCheck('some/file.ts', 'content', { dryRun: true, overwrite: true });

      expect(result).toEqual({ filePath: 'some/file.ts', outcome: 'overwritten' });
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('returns "up-to-date" when file exists with same content', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('same content');

      const result = writeFileWithCheck('some/file.ts', 'same content', { dryRun: true, overwrite: false });

      expect(result).toEqual({ filePath: 'some/file.ts', outcome: 'up-to-date' });
    });

    it('returns "skipped" when file exists with different content and overwrite is false', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('different content');

      const result = writeFileWithCheck('some/file.ts', 'new content', { dryRun: true, overwrite: false });

      expect(result).toEqual({ filePath: 'some/file.ts', outcome: 'skipped' });
    });
  });
});
