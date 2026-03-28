import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

import { writeSyntheticChangelog } from '../writeSyntheticChangelog.ts';

describe(writeSyntheticChangelog, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
  });

  it('writes a changelog entry for a single propagated dependency', () => {
    mockExistsSync.mockReturnValue(false);

    const result = writeSyntheticChangelog({
      changelogPath: 'packages/app',
      newVersion: '1.0.1',
      date: '2026-03-28',
      propagatedFrom: [{ packageName: '@scope/core', newVersion: '2.0.0' }],
    });

    expect(result).toBe('packages/app/CHANGELOG.md');
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      'packages/app/CHANGELOG.md',
      expect.stringContaining('## 1.0.1 — 2026-03-28'),
      'utf8',
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      'packages/app/CHANGELOG.md',
      expect.stringContaining('### Dependency updates'),
      'utf8',
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      'packages/app/CHANGELOG.md',
      expect.stringContaining('- Bumped `@scope/core` to 2.0.0'),
      'utf8',
    );
  });

  it('lists multiple propagated dependencies as separate bullets', () => {
    mockExistsSync.mockReturnValue(false);

    writeSyntheticChangelog({
      changelogPath: 'packages/app',
      newVersion: '1.0.1',
      date: '2026-03-28',
      propagatedFrom: [
        { packageName: '@scope/core', newVersion: '2.0.0' },
        { packageName: '@scope/utils', newVersion: '3.1.0' },
      ],
    });

    const writtenContent = mockWriteFileSync.mock.calls[0]?.[1];
    expect(writtenContent).toContain('- Bumped `@scope/core` to 2.0.0');
    expect(writtenContent).toContain('- Bumped `@scope/utils` to 3.1.0');
  });

  it('prepends to existing changelog content', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('## 1.0.0 — 2026-03-01\n\nInitial release.\n');

    writeSyntheticChangelog({
      changelogPath: 'packages/app',
      newVersion: '1.0.1',
      date: '2026-03-28',
      propagatedFrom: [{ packageName: '@scope/core', newVersion: '2.0.0' }],
    });

    const writtenContent = mockWriteFileSync.mock.calls[0]?.[1];
    expect(writtenContent).toMatch(/^## 1\.0\.1/);
    expect(writtenContent).toContain('## 1.0.0 — 2026-03-01');
  });

  it('creates the file when it does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    writeSyntheticChangelog({
      changelogPath: 'packages/new-pkg',
      newVersion: '0.0.1',
      date: '2026-03-28',
      propagatedFrom: [{ packageName: '@scope/core', newVersion: '1.0.0' }],
    });

    expect(mockReadFileSync).not.toHaveBeenCalled();
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
  });

  it('skips the write in dry-run mode but returns the file path', () => {
    const result = writeSyntheticChangelog({
      changelogPath: 'packages/app',
      newVersion: '1.0.1',
      date: '2026-03-28',
      propagatedFrom: [{ packageName: '@scope/core', newVersion: '2.0.0' }],
      dryRun: true,
    });

    expect(result).toBe('packages/app/CHANGELOG.md');
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(mockExistsSync).not.toHaveBeenCalled();
  });
});
