import type { CheckResult } from './format-check.ts';
import type { AuditScope } from './types.ts';

const HINT_ADD = 'Run `audit-deps sync` to add the listed vulnerabilities to the allowlist.';
const HINT_REMOVE = 'Run `audit-deps sync` to remove stale allowlist entries.';
const HINT_BOTH = 'Run `audit-deps sync` to add the listed vulnerabilities to the allowlist and remove stale entries.';

/** Build the `--verbose` flag string reflecting the original scope flags. */
function buildVerboseFlag(scopes: AuditScope[]): string {
  if (scopes.length === 1) {
    return `--${scopes[0]} --verbose`;
  }
  return '--verbose';
}

/** Pick the sync hint matching the current mix of unallowed vulns and stale entries. */
function selectSyncHint(hasUnallowed: boolean, hasStale: boolean): string {
  if (hasUnallowed && hasStale) return HINT_BOTH;
  if (hasUnallowed) return HINT_ADD;
  return HINT_REMOVE;
}

/**
 * Compute the "Actions:" footer for check output.
 *
 * Returns an empty string when the allowlist is fully current. Otherwise returns
 * a bulleted action list with a verbose hint (when vulns exist) and a sync hint.
 */
export function formatActionHints(result: CheckResult, scopes: AuditScope[]): string {
  const hasUnallowed = scopes.some((scope) => result[scope].unallowed.length > 0);
  const hasAllowed = scopes.some((scope) => result[scope].allowed.length > 0);
  const hasStale = scopes.some((scope) => result[scope].stale.length > 0);

  const hasVulns = hasUnallowed || hasAllowed;
  const needsSync = hasUnallowed || hasStale;

  if (!hasVulns && !needsSync) return '';

  const bullets: string[] = [];

  if (hasVulns) {
    bullets.push(`  \u{2022} Run \`audit-deps ${buildVerboseFlag(scopes)}\` for full report`);
  }

  if (needsSync) {
    bullets.push(`  \u{2022} ${selectSyncHint(hasUnallowed, hasStale)}`);
  }

  return `  Actions:\n${bullets.join('\n')}`;
}
