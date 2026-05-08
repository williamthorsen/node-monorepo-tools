import { describe, expect, it } from 'vitest';

import type { CheckResult, ScopeCheckResult } from '../src/format-check.ts';
import { deriveSummary } from '../src/format-summary.ts';
import type { AuditResult } from '../src/types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function fakeAdvisory(id: string): AuditResult {
  return { id, path: 'pkg', paths: ['pkg'], severity: 'high', url: `https://example.com/${id}` };
}

// ---------------------------------------------------------------------------
// deriveSummary
// ---------------------------------------------------------------------------

describe(deriveSummary, () => {
  it('returns status "none" with count 0 when both scopes are empty', () => {
    const result = makeCheckResult();
    expect(deriveSummary(result, ['prod', 'dev'])).toEqual({ status: 'none', count: 0 });
  });

  it('returns "vulnerabilities-found" with the total unallowed count across scopes', () => {
    const result = makeCheckResult({
      dev: { ...emptyScopeResult(), unallowed: [fakeAdvisory('GHSA-1')] },
      prod: { ...emptyScopeResult(), unallowed: [fakeAdvisory('GHSA-2'), fakeAdvisory('GHSA-3')] },
    });
    expect(deriveSummary(result, ['prod', 'dev'])).toEqual({ status: 'vulnerabilities-found', count: 3 });
  });

  it('returns "suppressed-vulnerabilities" with the total allowed count when no unallowed exist', () => {
    const result = makeCheckResult({
      prod: {
        ...emptyScopeResult(),
        allowed: [
          { id: 'GHSA-a', path: 'pkg', paths: ['pkg'], url: 'https://example.com/a' },
          { id: 'GHSA-b', path: 'pkg', paths: ['pkg'], url: 'https://example.com/b' },
        ],
      },
    });
    expect(deriveSummary(result, ['prod', 'dev'])).toEqual({ status: 'suppressed-vulnerabilities', count: 2 });
  });

  it('returns "stale-overrides" with the total stale count when no vulnerabilities exist', () => {
    const result = makeCheckResult({
      prod: { ...emptyScopeResult(), stale: [{ id: 'GHSA-old' }] },
    });
    expect(deriveSummary(result, ['prod', 'dev'])).toEqual({ status: 'stale-overrides', count: 1 });
  });

  it('prioritizes unallowed over allowed and stale, and reports only the unallowed count', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [{ id: 'GHSA-allowed', path: 'pkg', paths: ['pkg'], url: 'https://example.com/allowed' }],
        belowThreshold: [],
        stale: [{ id: 'GHSA-old' }, { id: 'GHSA-old2' }],
        unallowed: [fakeAdvisory('GHSA-new')],
      },
    });
    expect(deriveSummary(result, ['prod', 'dev'])).toEqual({ status: 'vulnerabilities-found', count: 1 });
  });

  it('prioritizes allowed over stale when no unallowed exist, and reports only the allowed count', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [{ id: 'GHSA-allowed', path: 'pkg', paths: ['pkg'], url: 'https://example.com/allowed' }],
        belowThreshold: [],
        stale: [{ id: 'GHSA-old' }],
        unallowed: [],
      },
    });
    expect(deriveSummary(result, ['prod', 'dev'])).toEqual({ status: 'suppressed-vulnerabilities', count: 1 });
  });

  it('ignores below-threshold findings when classifying status', () => {
    const result = makeCheckResult({
      prod: {
        ...emptyScopeResult(),
        belowThreshold: [
          { id: 'GHSA-bt', path: 'pkg', paths: ['pkg'], severity: 'low', url: 'https://example.com/bt' },
        ],
      },
    });
    expect(deriveSummary(result, ['prod', 'dev'])).toEqual({ status: 'none', count: 0 });
  });

  it('only considers requested scopes', () => {
    const result = makeCheckResult({
      dev: { ...emptyScopeResult(), unallowed: [fakeAdvisory('GHSA-dev-only')] },
      prod: emptyScopeResult(),
    });
    expect(deriveSummary(result, ['prod'])).toEqual({ status: 'none', count: 0 });
    expect(deriveSummary(result, ['dev'])).toEqual({ status: 'vulnerabilities-found', count: 1 });
  });
});
