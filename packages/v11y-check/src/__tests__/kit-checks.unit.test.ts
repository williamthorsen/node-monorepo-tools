import { describe, expect, it, vi } from 'vitest';

const { mockedExistsSync } = vi.hoisted(() => ({
  mockedExistsSync: vi.fn<typeof import('node:fs').existsSync>(),
}));

vi.mock(import('node:fs'), async (importOriginal) => {
  const actualModule = await importOriginal();
  return {
    ...actualModule,
    default: { ...actualModule, existsSync: mockedExistsSync },
    existsSync: mockedExistsSync,
  };
});

import { hasNoLegacyAuditCiDirectory } from '../../.readyup/kits/default.ts';

describe(hasNoLegacyAuditCiDirectory, () => {
  it('returns true when .audit-ci/ directory does not exist', () => {
    mockedExistsSync.mockReturnValue(false);

    expect(hasNoLegacyAuditCiDirectory()).toBe(true);
  });

  it('returns false when .audit-ci/ directory exists', () => {
    mockedExistsSync.mockReturnValue(true);

    expect(hasNoLegacyAuditCiDirectory()).toBe(false);
  });
});
