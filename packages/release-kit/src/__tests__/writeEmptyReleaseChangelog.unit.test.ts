import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

import { writeEmptyReleaseChangelog } from '../writeEmptyReleaseChangelog.ts';

describe(writeEmptyReleaseChangelog, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
  });

  it('writes the canonical header and Forced version bump bullet for a fresh file', () => {
    mockExistsSync.mockReturnValue(false);

    const result = writeEmptyReleaseChangelog({
      changelogPath: 'packages/app',
      newVersion: '1.0.1',
      date: '2026-05-06',
    });

    expect(result).toBe('packages/app/CHANGELOG.md');
    const writtenContent = mockWriteFileSync.mock.calls[0]?.[1];
    expect(writtenContent).toContain('## 1.0.1 — 2026-05-06');
    expect(writtenContent).toContain('### Notes');
    expect(writtenContent).toContain('- Forced version bump.');
  });

  it('prepends to existing changelog content', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('## 1.0.0 — 2026-03-01\n\nInitial release.\n');

    writeEmptyReleaseChangelog({
      changelogPath: 'packages/app',
      newVersion: '1.0.1',
      date: '2026-05-06',
    });

    const writtenContent = mockWriteFileSync.mock.calls[0]?.[1];
    expect(writtenContent).toMatch(/^## 1\.0\.1/);
    expect(writtenContent).toContain('## 1.0.0 — 2026-03-01');
    expect(writtenContent).toContain('Initial release.');
  });

  it('creates the file when it does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    writeEmptyReleaseChangelog({
      changelogPath: 'packages/new-pkg',
      newVersion: '0.0.1',
      date: '2026-05-06',
    });

    expect(mockReadFileSync).not.toHaveBeenCalled();
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
  });

  it('skips the write in dry-run mode but returns the file path', () => {
    const result = writeEmptyReleaseChangelog({
      changelogPath: 'packages/app',
      newVersion: '1.0.1',
      date: '2026-05-06',
      dryRun: true,
    });

    expect(result).toBe('packages/app/CHANGELOG.md');
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(mockExistsSync).not.toHaveBeenCalled();
  });
});
