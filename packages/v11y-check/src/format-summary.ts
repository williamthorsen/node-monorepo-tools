import type { CheckResult } from './format-check.ts';
import type { AuditScope } from './types.ts';

/** Status discriminant exposing the most severe finding category in a check result. */
export type CheckSummaryStatus = 'vulnerabilities-found' | 'suppressed-vulnerabilities' | 'stale-overrides' | 'none';

/** Headline summary of a check run: status discriminant plus count for the active category. */
export interface CheckSummary {
  status: CheckSummaryStatus;
  count: number;
}

/**
 * Derive the headline summary from a check result.
 *
 * Priority is severity-driven: unallowed > allowed > stale > none. The count is the total across
 * the requested scopes for the *active* category only; for `'none'` it is `0`. Below-threshold
 * findings never affect the summary — the threshold already excludes them from pass/fail.
 */
export function deriveSummary(result: CheckResult, scopes: AuditScope[]): CheckSummary {
  const unallowed = scopes.reduce((total, scope) => total + result[scope].unallowed.length, 0);
  if (unallowed > 0) return { status: 'vulnerabilities-found', count: unallowed };

  const allowed = scopes.reduce((total, scope) => total + result[scope].allowed.length, 0);
  if (allowed > 0) return { status: 'suppressed-vulnerabilities', count: allowed };

  const stale = scopes.reduce((total, scope) => total + result[scope].stale.length, 0);
  if (stale > 0) return { status: 'stale-overrides', count: stale };

  return { status: 'none', count: 0 };
}
