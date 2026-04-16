import type { CheckResult } from './format-check.ts';
import type { AuditScope } from './types.ts';

const HINT_ADD = 'Run `audit-deps sync` to add vulnerabilities to the allowlist.';
const HINT_REMOVE = 'Run `audit-deps sync` to remove stale allowlist entries.';
const HINT_BOTH = 'Run `audit-deps sync` to add vulnerabilities to the allowlist and remove stale entries.';

/**
 * Compute the "Actions:" footer for check output.
 *
 * Returns an empty string when the allowlist is fully current. Otherwise returns
 * `\nActions:\n  <hint>\n` describing what sync would do.
 */
export function formatActionHints(result: CheckResult, scopes: AuditScope[]): string {
  const hasUnallowed = scopes.some((scope) => result[scope].unallowed.length > 0);
  const hasStale = scopes.some((scope) => result[scope].stale.length > 0);

  if (hasUnallowed && hasStale) return footer(HINT_BOTH);
  if (hasUnallowed) return footer(HINT_ADD);
  if (hasStale) return footer(HINT_REMOVE);
  return '';
}

/** Wrap a single hint line in the "Actions:" footer format. */
function footer(hint: string): string {
  return `\nActions:\n  ${hint}\n`;
}
