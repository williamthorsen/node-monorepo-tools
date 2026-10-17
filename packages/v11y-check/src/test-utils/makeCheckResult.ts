import type { CheckResult, ScopeCheckResult } from '../format-check.ts';

/** Builds a check result whose scopes are empty unless the overrides replace them. */
export function makeCheckResult(overrides?: Partial<CheckResult>): CheckResult {
  return {
    dev: emptyScopeResult(),
    prod: emptyScopeResult(),
    ...overrides,
  };
}

// region | Helpers
/** Builds a scope result that does not contain any entries. */
function emptyScopeResult(): ScopeCheckResult {
  return { allowed: [], belowThreshold: [], stale: [], unallowed: [] };
}
// endregion | Helpers
