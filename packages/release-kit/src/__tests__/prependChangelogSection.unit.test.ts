import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

import { prependChangelogSection } from '../prependChangelogSection.ts';

describe(prependChangelogSection, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
  });

  it('writes only the section followed by a newline when the file does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    prependChangelogSection('packages/app/CHANGELOG.md', '## 1.0.0 — 2026-05-06\n', false);

    expect(mockReadFileSync).not.toHaveBeenCalled();
    expect(mockWriteFileSync).toHaveBeenCalledWith('packages/app/CHANGELOG.md', '## 1.0.0 — 2026-05-06\n\n', 'utf8');
  });

  it('prepends the section ahead of existing content separated by a blank line', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('## 0.9.0 — 2026-03-01\n\nPrevious release.\n');

    prependChangelogSection('packages/app/CHANGELOG.md', '## 1.0.0 — 2026-05-06\n', false);

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      'packages/app/CHANGELOG.md',
      '## 1.0.0 — 2026-05-06\n\n## 0.9.0 — 2026-03-01\n\nPrevious release.\n',
      'utf8',
    );
  });

  it('performs no I/O in dry-run mode', () => {
    prependChangelogSection('packages/app/CHANGELOG.md', '## 1.0.0 — 2026-05-06\n', true);

    expect(mockExistsSync).not.toHaveBeenCalled();
    expect(mockReadFileSync).not.toHaveBeenCalled();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});
