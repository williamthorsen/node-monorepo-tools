import { afterEach, describe, expect, it, vi } from 'vitest';

import { updateManagedFile } from '../updateManagedFile.ts';

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

describe(updateManagedFile, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockMkdirSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
  });

  it('creates a missing file, with its parent directory', () => {
    mockExistsSync.mockReturnValue(false);

    const result = updateManagedFile('dir/file.yaml', 'content\n', { dryRun: false });

    expect(result).toStrictEqual({ filePath: 'dir/file.yaml', outcome: 'created' });
    expect(mockMkdirSync).toHaveBeenCalledWith('dir', { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalledWith('dir/file.yaml', 'content\n', 'utf8');
  });

  it('reports an identical file as up to date without writing it', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('content\n');

    const result = updateManagedFile('file.yaml', 'content\n', { dryRun: false });

    expect(result).toStrictEqual({ filePath: 'file.yaml', outcome: 'up-to-date' });
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('updates a file that differs only in trailing whitespace', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('content  \n');

    const result = updateManagedFile('file.yaml', 'content\n', { dryRun: false });

    expect(result.outcome).toBe('updated');
    expect(mockWriteFileSync).toHaveBeenCalledWith('file.yaml', 'content\n', 'utf8');
  });

  it('returns the hunks that turn the existing file into the rendered content', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('a\nb\nc\n');

    const result = updateManagedFile('file.yaml', 'a\nB\nc\n', { dryRun: false });

    expect(result).toStrictEqual({
      filePath: 'file.yaml',
      outcome: 'updated',
      diff: ['@@ -1,3 +1,3 @@', ' a', '-b', '+B', ' c'].join('\n'),
    });
  });

  it('omits the end-of-file newline markers from the diff', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('a');

    const result = updateManagedFile('file.yaml', 'a\n', { dryRun: false });

    expect(result.diff).not.toContain(String.raw`\ No newline`);
  });

  it('writes nothing under dryRun', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('old\n');

    const result = updateManagedFile('file.yaml', 'new\n', { dryRun: true });

    expect(result.outcome).toBe('updated');
    expect(result.diff).toContain('+new');
    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('returns a failure when the existing file cannot be read', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('EISDIR: illegal operation on a directory');
    });

    const result = updateManagedFile('file.yaml', 'content\n', { dryRun: false });

    expect(result).toStrictEqual({
      filePath: 'file.yaml',
      outcome: 'failed',
      error: 'EISDIR: illegal operation on a directory',
    });
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('returns a failure when the write fails', () => {
    mockExistsSync.mockReturnValue(false);
    mockWriteFileSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    const result = updateManagedFile('file.yaml', 'content\n', { dryRun: false });

    expect(result).toStrictEqual({ filePath: 'file.yaml', outcome: 'failed', error: 'EACCES: permission denied' });
  });
});
