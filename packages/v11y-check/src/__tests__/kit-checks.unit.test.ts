import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockedExistsSync } = vi.hoisted(() => ({
  mockedExistsSync: vi.fn<typeof import('node:fs').existsSync>(),
}));

vi.mock(import('node:fs'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: { ...actual, existsSync: mockedExistsSync },
    existsSync: mockedExistsSync,
  };
});

import { noLegacyAuditCiDirectory, skipLegacyAuditCiCheck } from '../../.readyup/kits/default.ts';

describe(noLegacyAuditCiDirectory, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when .audit-ci/ directory does not exist', () => {
    mockedExistsSync.mockReturnValue(false);

    expect(noLegacyAuditCiDirectory()).toBe(true);
  });

  it('returns false when .audit-ci/ directory exists', () => {
    mockedExistsSync.mockReturnValue(true);

    expect(noLegacyAuditCiDirectory()).toBe(false);
  });
});

describe(skipLegacyAuditCiCheck, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns skip message when .audit-ci/ directory does not exist', () => {
    mockedExistsSync.mockReturnValue(false);

    expect(skipLegacyAuditCiCheck()).toBe('no legacy .audit-ci/ directory');
  });

  it('returns false when .audit-ci/ directory exists (check should run)', () => {
    mockedExistsSync.mockReturnValue(true);

    expect(skipLegacyAuditCiCheck()).toBe(false);
  });
});
