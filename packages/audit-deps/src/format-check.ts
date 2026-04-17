import { formatActionHints } from './format-actions.ts';
import { formatRelativeTime } from './format-time.ts';
import type { AuditResult, AuditScope, SeverityThreshold } from './types.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Classification of an allowlist entry relative to current audit findings. */
export interface AllowedVuln {
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
  allowed: AllowedVuln[];
  belowThreshold: AuditResult[];
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
// Display ID helper
// ---------------------------------------------------------------------------

/** Resolve the best display ID for a vulnerability: GHSA ID if available, otherwise the numeric ID. */
export function displayId(vuln: { ghsaId?: string | undefined; id: string }): string {
  return vuln.ghsaId ?? vuln.id;
}

// ---------------------------------------------------------------------------
// Scope labels
// ---------------------------------------------------------------------------

const SCOPE_LABELS: Record<AuditScope, string> = {
  dev: '  \u{1F527} dev:',
  prod: '  \u{1F4E6} prod:',
};

const SCOPE_NAMES: Record<AuditScope, string> = {
  dev: 'dev',
  prod: 'prod',
};

// ---------------------------------------------------------------------------
// Text formatter
// ---------------------------------------------------------------------------

/** Format a threshold annotation, e.g. `(threshold: 🟠 moderate)`. Returns empty string for `low` threshold. */
function formatThresholdAnnotation(threshold: SeverityThreshold | undefined): string {
  if (threshold === undefined || threshold === 'low') return '';
  const indicator = severityIndicator(threshold);
  const indicatorPart = indicator.length > 0 ? `${indicator} ` : '';
  return `(threshold: ${indicatorPart}${threshold})`;
}

/** Build the intro banner reflecting the scopes being audited. */
function formatIntroBanner(scopes: AuditScope[], thresholds?: Partial<Record<AuditScope, SeverityThreshold>>): string {
  const first = scopes[0];
  // `first` is always defined here; the guard narrows for TypeScript.
  if (scopes.length === 1 && first !== undefined) {
    const annotation = formatThresholdAnnotation(thresholds?.[first]);
    return `\u{1F52C} Auditing ${SCOPE_NAMES[first]} dependencies${annotation && ` ${annotation}`} ...`;
  }
  return '\u{1F52C} Auditing dependencies ...';
}

/** Build the severity suffix for a finding line, e.g. `  🔴 critical`. */
export function formatSeveritySuffix(severity: string | undefined): string {
  if (severity === undefined || severity === '') return '';
  const emoji = severityIndicator(severity);
  const emojiPart = emoji.length > 0 ? `${emoji} ` : '';
  return `  ${emojiPart}${severity}`;
}

/** Build the "allowed since X ago (datetime)" suffix for entries with `addedAt`. */
function formatAllowedSuffix(addedAt: string, now: Date): string {
  const relative = formatRelativeTime(addedAt, now);
  if (relative.length === 0) return ` \u{2022} \u{2705} allowed (${addedAt})`;
  return ` \u{2022} \u{2705} allowed since ${relative} (${addedAt})`;
}

/** Format a single unallowed vulnerability as a bullet line. */
function formatUnallowedLine(vuln: AuditResult): string {
  return `  \u{2022} \u{1F6A8} ${displayId(vuln)}: ${vuln.path}${formatSeveritySuffix(vuln.severity)}`;
}

/** Format a single allowed vulnerability as a bullet line. */
function formatAllowedLine(vuln: AllowedVuln, now: Date): string {
  const suffix = vuln.addedAt !== undefined ? formatAllowedSuffix(vuln.addedAt, now) : '';
  return `  \u{2022} \u{26A0}\u{FE0F} ${displayId(vuln)}: ${vuln.path}${formatSeveritySuffix(vuln.severity)}${suffix}`;
}

/** Format a single stale entry as a bullet line. */
function formatStaleLine(entry: StaleEntry): string {
  return `  \u{2022} \u{1F5D1}\u{FE0F} ${entry.id} \u{2022} not needed`;
}

/** Format a single below-threshold vulnerability as a bullet line. */
function formatBelowThresholdLine(vuln: AuditResult): string {
  return `  \u{2022} \u{2139}\u{FE0F} ${displayId(vuln)}: ${vuln.path}${formatSeveritySuffix(vuln.severity)} \u{2022} \u{1F6AB} ignored`;
}

/** Check whether a scope has any findings. */
function hasFindings(result: ScopeCheckResult): boolean {
  return (
    result.unallowed.length > 0 ||
    result.allowed.length > 0 ||
    result.stale.length > 0 ||
    result.belowThreshold.length > 0
  );
}

/** Format a scope's finding lines (without scope header). */
function formatScopeFindings(result: ScopeCheckResult, now: Date): string[] {
  const lines: string[] = [];
  for (const vuln of result.unallowed) {
    lines.push(formatUnallowedLine(vuln));
  }
  for (const vuln of result.allowed) {
    lines.push(formatAllowedLine(vuln, now));
  }
  for (const entry of result.stale) {
    lines.push(formatStaleLine(entry));
  }
  for (const vuln of result.belowThreshold) {
    lines.push(formatBelowThresholdLine(vuln));
  }
  return lines;
}

/**
 * Format check results as human-readable text output.
 *
 * Produces an intro banner, scoped findings with severity labels and GHSA IDs,
 * and an action hints footer.
 */
export function formatCheckText(
  result: CheckResult,
  scopes: AuditScope[],
  now?: Date,
  thresholds?: Partial<Record<AuditScope, SeverityThreshold>>,
): string {
  const effectiveNow = now ?? new Date();
  const lines: string[] = [formatIntroBanner(scopes, thresholds)];

  const anyFindings = scopes.some((scope) => hasFindings(result[scope]));

  if (!anyFindings) {
    lines.push('No known vulnerabilities found.');
    return lines.join('\n') + '\n';
  }

  // Single scope: no scope header, findings directly below banner.
  const singleScope = scopes.length === 1 ? scopes[0] : undefined;
  if (singleScope !== undefined) {
    const scope = singleScope;
    const scopeResult = result[scope];
    lines.push(...formatScopeFindings(scopeResult, effectiveNow));
    const actions = formatActionHints(result, scopes);
    if (actions.length > 0) {
      lines.push('', ...actions.split('\n').filter((l) => l.length > 0));
    }
    return lines.join('\n') + '\n';
  }

  // Multiple scopes: show scope headers.
  for (const scope of scopes) {
    const scopeResult = result[scope];
    const annotation = formatThresholdAnnotation(thresholds?.[scope]);
    const header = `${SCOPE_LABELS[scope]}${annotation && ` ${annotation}`}`;
    lines.push(header);
    if (hasFindings(scopeResult)) {
      lines.push(...formatScopeFindings(scopeResult, effectiveNow));
    } else {
      lines.push('  No known vulnerabilities found.');
    }
    lines.push('');
  }

  const actions = formatActionHints(result, scopes);
  if (actions.length > 0) {
    lines.push(...actions.split('\n').filter((l) => l.length > 0));
  }

  return lines.join('\n') + '\n';
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
