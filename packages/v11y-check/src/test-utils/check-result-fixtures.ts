import type { CheckResult, ScopeCheckResult } from '../format-check.ts';

/** Builds a scope result that does not contain any entries. */
export function buildEmptyScopeResult(): ScopeCheckResult {
  return { allowed: [], belowThreshold: [], stale: [], unallowed: [] };
}

/** Builds a check result whose scopes are empty unless the overrides replace them. */
export function makeCheckResult(overrides?: Partial<CheckResult>): CheckResult {
  return {
    dev: buildEmptyScopeResult(),
    prod: buildEmptyScopeResult(),
    ...overrides,
  };
}
