import { describe, expect, it } from 'vitest';

import { formatActionHints } from '../src/format-actions.ts';
import type { CheckResult, ScopeCheckResult } from '../src/format-check.ts';

function emptyScopeResult(): ScopeCheckResult {
  return { allowed: [], belowThreshold: [], stale: [], unallowed: [] };
}

function makeCheckResult(overrides?: Partial<CheckResult>): CheckResult {
  return {
    dev: emptyScopeResult(),
    prod: emptyScopeResult(),
    ...overrides,
  };
}

describe(formatActionHints, () => {
  it('returns empty string when no unallowed, allowed, or stale entries exist', () => {
    const result = makeCheckResult();
    expect(formatActionHints(result, ['prod', 'dev'])).toBe('');
  });

  it('returns verbose and sync hints when unallowed vulnerabilities exist', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [],
        stale: [],
        unallowed: [{ id: 'GHSA-1', path: 'pkg', paths: ['pkg'], url: 'https://example.com/1' }],
      },
    });

    const output = formatActionHints(result, ['prod']);
    expect(output).toContain('Actions:');
    expect(output).toContain('  \u{2022} Run `audit-deps --prod --verbose` for full report');
    expect(output).toContain('  \u{2022} Run `audit-deps sync` to add vulnerabilities to the allowlist.');
  });

  it('returns remove-only hint without verbose hint when only stale entries exist', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [],
        stale: [{ id: 'GHSA-stale' }],
        unallowed: [],
      },
    });

    const output = formatActionHints(result, ['prod']);
    expect(output).toContain('  \u{2022} Run `audit-deps sync` to remove stale allowlist entries.');
    expect(output).not.toContain('--verbose');
  });

  it('returns combined sync hint when both unallowed and stale entries exist', () => {
    const result = makeCheckResult({
      dev: {
        allowed: [],
        belowThreshold: [],
        stale: [{ id: 'GHSA-stale' }],
        unallowed: [],
      },
      prod: {
        allowed: [],
        belowThreshold: [],
        stale: [],
        unallowed: [{ id: 'GHSA-1', path: 'pkg', paths: ['pkg'], url: 'https://example.com/1' }],
      },
    });

    const output = formatActionHints(result, ['prod', 'dev']);
    expect(output).toContain('add vulnerabilities to the allowlist and remove stale entries');
  });

  it('only considers scopes included in the scopes array', () => {
    const result = makeCheckResult({
      dev: {
        allowed: [],
        belowThreshold: [],
        stale: [],
        unallowed: [{ id: 'GHSA-dev', path: 'pkg', paths: ['pkg'], url: 'https://example.com/dev' }],
      },
    });

    // Only 'prod' is passed; dev's unallowed should be ignored.
    expect(formatActionHints(result, ['prod'])).toBe('');
  });

  it('uses --verbose without scope flag when both scopes are audited', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [],
        stale: [],
        unallowed: [{ id: 'GHSA-1', path: 'pkg', paths: ['pkg'], url: 'https://example.com/1' }],
      },
    });

    const output = formatActionHints(result, ['prod', 'dev']);
    expect(output).toContain('Run `audit-deps --verbose` for full report');
  });

  it('uses --dev --verbose when only dev scope is audited', () => {
    const result = makeCheckResult({
      dev: {
        allowed: [],
        belowThreshold: [],
        stale: [],
        unallowed: [{ id: 'GHSA-1', path: 'pkg', paths: ['pkg'], url: 'https://example.com/1' }],
      },
    });

    const output = formatActionHints(result, ['dev']);
    expect(output).toContain('Run `audit-deps --dev --verbose` for full report');
  });

  it('shows verbose hint and remove-only sync hint when allowed and stale entries exist without unallowed', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [{ id: 'GHSA-1', path: 'pkg', paths: ['pkg'], severity: 'low', url: 'https://example.com/1' }],
        belowThreshold: [],
        stale: [{ id: 'GHSA-stale' }],
        unallowed: [],
      },
    });

    const output = formatActionHints(result, ['prod']);
    expect(output).toContain('Run `audit-deps --prod --verbose` for full report');
    expect(output).toContain('Run `audit-deps sync` to remove stale allowlist entries.');
  });

  it('shows verbose hint when only allowed vulns exist', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [{ id: 'GHSA-1', path: 'pkg', paths: ['pkg'], severity: 'low', url: 'https://example.com/1' }],
        belowThreshold: [],
        stale: [],
        unallowed: [],
      },
    });

    const output = formatActionHints(result, ['prod']);
    expect(output).toContain('Run `audit-deps --prod --verbose` for full report');
    // No sync hint since nothing to sync
    expect(output).not.toContain('audit-deps sync');
  });

  it('returns empty string when only below-threshold findings exist', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [
          { id: 'GHSA-bt', path: 'pkg', paths: ['pkg'], severity: 'low', url: 'https://example.com/bt' },
        ],
        stale: [],
        unallowed: [],
      },
    });

    expect(formatActionHints(result, ['prod'])).toBe('');
  });
});
