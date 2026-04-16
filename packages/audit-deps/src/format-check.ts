import { formatActionHints } from './format-actions.ts';
import type { AuditResult, AuditScope } from './types.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Classification of an allowlist entry relative to current audit findings. */
export interface AllowedVuln {
  addedAt?: string | undefined;
  cvss?: { score?: number; vectorString?: string } | undefined;
  description?: string | undefined;
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
  allowed: AllowedVuln[];
  stale: StaleEntry[];
  unallowed: AuditResult[];
}

/** Aggregated check results across scopes. */
export interface CheckResult {
  dev: ScopeCheckResult;
  prod: ScopeCheckResult;
}

// ---------------------------------------------------------------------------
// Severity indicator
// ---------------------------------------------------------------------------

const SEVERITY_INDICATORS: Record<string, string> = {
  critical: '\u{1F534}',
  high: '\u{1F534}',
  info: '\u{1F7E1}',
  low: '\u{1F7E1}',
  moderate: '\u{1F7E0}',
};

/** Map a severity string to a colored circle emoji. */
export function severityIndicator(severity: string | undefined): string {
  if (severity === undefined) return '';
  return SEVERITY_INDICATORS[severity] ?? '';
}

// ---------------------------------------------------------------------------
// Text formatter
// ---------------------------------------------------------------------------

/** Scope display metadata. */
const SCOPE_HEADERS: Record<AuditScope, string> = {
  prod: '-- \u{1F4E6} prod --',
  dev: '-- \u{1F527} dev --',
};

/** Format a vulnerability line with optional severity indicator and suffix. */
function formatVulnLine(
  vuln: { id: string; path: string; severity?: string | undefined; url: string },
  suffix?: string,
): string {
  const indicator = severityIndicator(vuln.severity);
  const prefix = indicator.length > 0 ? `${indicator} ` : '';
  const tail = suffix !== undefined ? ` ${suffix}` : '';
  return `  ${prefix}${vuln.id}: ${vuln.path} (${vuln.url})${tail}`;
}

/** Format a single scope's check results as text lines. */
function formatScopeText(scope: AuditScope, result: ScopeCheckResult): string {
  const lines: string[] = [SCOPE_HEADERS[scope]];

  const hasFindings = result.unallowed.length > 0 || result.allowed.length > 0 || result.stale.length > 0;

  if (!hasFindings) {
    lines.push('  (none)');
    return lines.join('\n');
  }

  for (const vuln of result.unallowed) {
    lines.push(formatVulnLine(vuln));
  }

  for (const vuln of result.allowed) {
    lines.push(formatVulnLine(vuln, '\u{1F6AB} allowed'));
  }

  for (const entry of result.stale) {
    lines.push(`  \u{1F5D1}\u{FE0F} ${entry.id}  not needed`);
  }

  return lines.join('\n');
}

/** Format check results as human-readable text output. */
export function formatCheckText(result: CheckResult, scopes: AuditScope[]): string {
  const sections: string[] = [];

  for (const scope of scopes) {
    sections.push(formatScopeText(scope, result[scope]));
  }

  return sections.join('\n\n') + '\n' + formatActionHints(result, scopes);
}

// ---------------------------------------------------------------------------
// JSON formatter
// ---------------------------------------------------------------------------

/** Format check results as a JSON string. */
export function formatCheckJson(result: CheckResult, scopes: AuditScope[]): string {
  const output: Record<string, ScopeCheckResult> = {};
  for (const scope of scopes) {
    output[scope] = result[scope];
  }
  return JSON.stringify(output, null, 2) + '\n';
}
