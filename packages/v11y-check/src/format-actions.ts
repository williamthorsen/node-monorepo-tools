import type { CheckResult } from './format-check.ts';
import type { AuditScope } from './types.ts';

const ADD_SYNC_HINT = 'Run `v11y sync` to add the listed vulnerabilities to the allowlist.';
const REMOVE_SYNC_HINT = 'Run `v11y sync` to remove stale allowlist entries.';
const ADD_AND_REMOVE_SYNC_HINT =
  'Run `v11y sync` to add the listed vulnerabilities to the allowlist and remove stale entries.';

/** Builds the `--verbose` flag string reflecting the original scope flags. */
function buildVerboseFlag(scopes: AuditScope[]): string {
  if (scopes.length === 1) {
    return `--${scopes[0]} --verbose`;
  }
  return '--verbose';
}

/** Picks the sync hint matching the current mix of unallowed vulns and stale entries. */
function selectSyncHint(hasUnallowed: boolean, hasStale: boolean): string {
  if (hasUnallowed && hasStale) return ADD_AND_REMOVE_SYNC_HINT;
  if (hasUnallowed) return ADD_SYNC_HINT;
  return REMOVE_SYNC_HINT;
}

/**
 * Computes the "Actions:" footer for check output.
 *
 * Returns an empty string when the allowlist is fully current. Otherwise returns
 * a bulleted action list with a verbose hint (when vulns exist) and a sync hint.
 */
export function formatActionHints(result: CheckResult, scopes: AuditScope[]): string {
  const hasUnallowed = scopes.some((scope) => result[scope].unallowed.length > 0);
  const hasAllowed = scopes.some((scope) => result[scope].allowed.length > 0);
  const hasStale = scopes.some((scope) => result[scope].stale.length > 0);

  const hasVulnerabilities = hasUnallowed || hasAllowed;
  const isSyncNeeded = hasUnallowed || hasStale;

  if (!hasVulnerabilities && !isSyncNeeded) return '';

  const bullets: string[] = [];

  if (hasVulnerabilities) {
    bullets.push(`  \u{2022} Run \`v11y check ${buildVerboseFlag(scopes)}\` for full report`);
  }

  if (isSyncNeeded) {
    bullets.push(`  \u{2022} ${selectSyncHint(hasUnallowed, hasStale)}`);
  }

  return `  Actions:\n${bullets.join('\n')}`;
}
