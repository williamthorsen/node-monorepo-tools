import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveAuditCiBin, runAuditCi } from '../runAuditCi.ts';

const PACKAGE_DIR = path.resolve(import.meta.dirname, '..', '..', '..', '..');

describe(resolveAuditCiBin, () => {
  it('returns a non-empty path to the audit-ci bin', () => {
    // audit-ci resolves in this environment, so the assertion accepts either branch's path.
    const result = resolveAuditCiBin();
    expect(result).toBeTypeOf('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe(runAuditCi, () => {
  it("returns audit-ci's exit status and output", () => {
    const result = runAuditCi(['--version'], PACKAGE_DIR);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });
});
