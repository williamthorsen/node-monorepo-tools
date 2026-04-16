import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockedFileExists, mockedExistsSync } = vi.hoisted(() => ({
  mockedFileExists: vi.fn<(path: string) => boolean>(),
  mockedExistsSync: vi.fn<(path: string) => boolean>(),
}));

vi.mock('readyup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('readyup')>();
  return {
    ...actual,
    fileExists: mockedFileExists,
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: { ...actual, existsSync: mockedExistsSync },
    existsSync: mockedExistsSync,
  };
});

import { auditDepsConfigExists, noLegacyAuditCiDirectory, skipLegacyAuditCiCheck } from '../audit-deps.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe(auditDepsConfigExists, () => {
  it('returns true when config file exists', () => {
    mockedFileExists.mockReturnValue(true);

    expect(auditDepsConfigExists()).toBe(true);
    expect(mockedFileExists).toHaveBeenCalledWith('.config/audit-deps.config.json');
  });

  it('returns false when config file is absent', () => {
    mockedFileExists.mockReturnValue(false);

    expect(auditDepsConfigExists()).toBe(false);
  });
});

describe(noLegacyAuditCiDirectory, () => {
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
  it('returns skip message when .audit-ci/ directory does not exist', () => {
    mockedExistsSync.mockReturnValue(false);

    expect(skipLegacyAuditCiCheck()).toBe('no legacy .audit-ci/ directory');
  });

  it('returns false when .audit-ci/ directory exists (check should run)', () => {
    mockedExistsSync.mockReturnValue(true);

    expect(skipLegacyAuditCiCheck()).toBe(false);
  });
});
