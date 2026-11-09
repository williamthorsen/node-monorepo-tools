import {
  type AllowlistEntry,
  type AuditResult,
  isSeverityAtOrAbove,
  type ScopeConfig,
  type SeverityThreshold,
} from './types.ts';

// region | Types
/** An audit finding that the allowlist admits, with the entry's reason and date. */
export interface AllowedVulnerability {
  addedAt?: string | undefined;
  cvss?: { score?: number; vectorString?: string } | undefined;
  description?: string | undefined;
  ghsaId?: string | undefined;
  id: string;
  path: string;
  paths: string[];
  reason?: string | undefined;
  severity?: string | undefined;
  title?: string | undefined;
  url: string;
}

/** An allowlist entry whose ID no longer appears in audit results. */
export interface StaleEntry {
  id: string;
}

/** Check results for a single scope. */
export interface ScopeCheckResult {
  allowed: AllowedVulnerability[];
  belowThreshold: AuditResult[];
  stale: StaleEntry[];
  unallowed: AuditResult[];
}

/** Aggregated check results across scopes. */
export interface CheckResult {
  dev: ScopeCheckResult;
  prod: ScopeCheckResult;
}
// endregion | Types

/**
 * Classifies one scope's audit results against its config as allowed, below threshold, or unallowed, and reports each
 * allowlist entry that matches none of the results as stale.
 */
export function classifyScopeResults(results: AuditResult[], scopeConfig: ScopeConfig): ScopeCheckResult {
  const threshold = resolveSeverityThreshold(scopeConfig);
  const allowlistById = new Map<string, AllowlistEntry>(scopeConfig.allowlist.map((entry) => [entry.id, entry]));
  const foundIds = new Set(results.map((result) => result.id));
  const scopeResult: ScopeCheckResult = { allowed: [], belowThreshold: [], stale: [], unallowed: [] };

  // Test the threshold before the allowlist: The threshold already excludes a below-threshold vulnerability from the
  // pass/fail decision, so the check reports it as ignored even when the allowlist names it.
  for (const result of results) {
    const entry = allowlistById.get(result.id);
    if (!isSeverityAtOrAbove(result.severity, threshold)) {
      scopeResult.belowThreshold.push(result);
    } else if (entry === undefined) {
      scopeResult.unallowed.push(result);
    } else {
      scopeResult.allowed.push(buildAllowedVulnerability(result, entry));
    }
  }

  for (const entry of scopeConfig.allowlist) {
    if (!foundIds.has(entry.id)) {
      scopeResult.stale.push({ id: entry.id });
    }
  }

  return scopeResult;
}

/** Returns the severity threshold that applies to a scope, defaulting to `low`. */
export function resolveSeverityThreshold(scopeConfig: ScopeConfig): SeverityThreshold {
  return scopeConfig.severityThreshold ?? 'low';
}

// region | Helpers
/** Merges an `AuditResult` with an `AllowlistEntry` into an `AllowedVulnerability`, omitting absent optional fields. */
function buildAllowedVulnerability(result: AuditResult, entry: AllowlistEntry): AllowedVulnerability {
  const allowedVulnerability: AllowedVulnerability = {
    id: result.id,
    path: result.path,
    paths: result.paths,
    url: result.url,
  };
  if (result.ghsaId !== undefined) allowedVulnerability.ghsaId = result.ghsaId;
  if (result.severity !== undefined) allowedVulnerability.severity = result.severity;
  if (result.title !== undefined) allowedVulnerability.title = result.title;
  if (result.description !== undefined) allowedVulnerability.description = result.description;
  if (result.cvss !== undefined) allowedVulnerability.cvss = result.cvss;
  if (entry.reason !== undefined) allowedVulnerability.reason = entry.reason;
  if (entry.addedAt !== undefined) allowedVulnerability.addedAt = entry.addedAt;
  return allowedVulnerability;
}
// endregion | Helpers
