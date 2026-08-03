import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExecSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:child_process'), () => ({
  execSync: mockExecSync,
}));

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
}));

import { RETIRED_SYNC_LABELS_CONFIG_PATH } from '../retiredConfig.ts';
import { syncLabelsCommand } from '../syncCommand.ts';

/** Make only the given repo files exist. */
function givenExistingFiles(...paths: string[]): void {
  mockExistsSync.mockImplementation((path: string) => paths.includes(path));
}

describe(syncLabelsCommand, () => {
  afterEach(() => {
    mockExecSync.mockReset();
    mockExistsSync.mockReset();
    vi.restoreAllMocks();
  });

  it('returns 1 with a migration message when the retired sync-labels config exists', () => {
    givenExistingFiles(RETIRED_SYNC_LABELS_CONFIG_PATH);
    const errorSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const result = syncLabelsCommand();

    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('no longer read'));
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('returns 1 when gh CLI is not available', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'gh --version') throw new Error('command not found: gh');
      return Buffer.from('');
    });
    const errorSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const result = syncLabelsCommand();

    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('gh'));
  });

  it('returns 1 when workflow file does not exist', () => {
    mockExecSync.mockReturnValue(Buffer.from('gh version 2.0.0'));
    mockExistsSync.mockReturnValue(false);
    const errorSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const result = syncLabelsCommand();

    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('sync-labels.yaml'));
  });

  it('returns 0 and triggers workflow on success', () => {
    mockExecSync.mockReturnValue(Buffer.from(''));
    givenExistingFiles('.github/workflows/sync-labels.yaml');
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const result = syncLabelsCommand();

    expect(result).toBe(0);
    expect(mockExecSync).toHaveBeenCalledWith('gh workflow run sync-labels.yaml', { stdio: 'inherit' });
  });

  it('returns 1 when gh workflow run throws', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'gh --version') return Buffer.from('gh version 2.0.0');
      throw new Error('workflow dispatch failed');
    });
    givenExistingFiles('.github/workflows/sync-labels.yaml');
    const errorSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const result = syncLabelsCommand();

    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('workflow dispatch failed'));
  });
});
