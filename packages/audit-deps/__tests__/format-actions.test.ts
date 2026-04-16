import { describe, expect, it } from 'vitest';

import { formatActionHints } from '../src/format-actions.ts';
import type { CheckResult, ScopeCheckResult } from '../src/format-check.ts';

function emptyScopeResult(): ScopeCheckResult {
  return { allowed: [], stale: [], unallowed: [] };
}

function makeCheckResult(overrides?: Partial<CheckResult>): CheckResult {
  return {
    dev: emptyScopeResult(),
    prod: emptyScopeResult(),
    ...overrides,
  };
}

describe(formatActionHints, () => {
  it('returns empty string when no unallowed or stale entries exist', () => {
    const result = makeCheckResult();
    expect(formatActionHints(result, ['prod', 'dev'])).toBe('');
  });

  it('returns the add-only hint when only unallowed vulnerabilities exist', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        stale: [],
        unallowed: [{ id: 'GHSA-1', path: 'pkg', paths: ['pkg'], url: 'https://example.com/1' }],
      },
    });

    const output = formatActionHints(result, ['prod']);
    expect(output).toBe('\nActions:\n  Run `audit-deps sync` to add vulnerabilities to the allowlist.\n');
  });

  it('returns the remove-only hint when only stale entries exist', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        stale: [{ id: 'GHSA-stale' }],
        unallowed: [],
      },
    });

    const output = formatActionHints(result, ['prod']);
    expect(output).toBe('\nActions:\n  Run `audit-deps sync` to remove stale allowlist entries.\n');
  });

  it('returns the combined hint when both unallowed and stale entries exist', () => {
    const result = makeCheckResult({
      dev: {
        allowed: [],
        stale: [{ id: 'GHSA-stale' }],
        unallowed: [],
      },
      prod: {
        allowed: [],
        stale: [],
        unallowed: [{ id: 'GHSA-1', path: 'pkg', paths: ['pkg'], url: 'https://example.com/1' }],
      },
    });

    const output = formatActionHints(result, ['prod', 'dev']);
    expect(output).toBe(
      '\nActions:\n  Run `audit-deps sync` to add vulnerabilities to the allowlist and remove stale entries.\n',
    );
  });

  it('only considers scopes included in the scopes array', () => {
    const result = makeCheckResult({
      dev: {
        allowed: [],
        stale: [],
        unallowed: [{ id: 'GHSA-dev', path: 'pkg', paths: ['pkg'], url: 'https://example.com/dev' }],
      },
    });

    // Only 'prod' is passed; dev's unallowed should be ignored.
    expect(formatActionHints(result, ['prod'])).toBe('');
  });
});
