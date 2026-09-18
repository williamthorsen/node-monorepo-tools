import { formatGlyphLine, type OutputStyle } from '@williamthorsen/nmr-core';

import { formatActionHints } from './format-actions.ts';
import { deriveSummary } from './format-summary.ts';
import { formatRelativeTime } from './format-time.ts';
import { formatMarkedLine, V11Y_GLYPHS, type V11yGlyphName } from './glyphs.ts';
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

const SEVERITY_GLYPH_NAMES: Record<string, V11yGlyphName> = {
  critical: 'severityHigh',
  high: 'severityHigh',
  info: 'severityLow',
  low: 'severityLow',
  moderate: 'severityModerate',
};

/** Maps a severity string to its indicator in a style: a colored circle when rich, nothing when plain. */
export function severityIndicator(severity: string | undefined, style: OutputStyle): string {
  if (severity === undefined) return '';
  const name = SEVERITY_GLYPH_NAMES[severity];
  return name === undefined ? '' : V11Y_GLYPHS[style][name].text;
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

const SCOPE_GLYPH_NAMES: Record<AuditScope, V11yGlyphName> = {
  dev: 'scopeDev',
  prod: 'scopeProd',
};

const SCOPE_NAMES: Record<AuditScope, string> = {
  dev: 'dev',
  prod: 'prod',
};

// ---------------------------------------------------------------------------
// Text formatter
// ---------------------------------------------------------------------------

/** Format a threshold annotation, e.g. `(threshold: 🟠 moderate)`. Returns empty string for `low` threshold. */
function formatThresholdAnnotation(threshold: SeverityThreshold | undefined, style: OutputStyle): string {
  if (threshold === undefined || threshold === 'low') return '';
  const indicator = severityIndicator(threshold, style);
  const indicatorPart = indicator.length > 0 ? `${indicator} ` : '';
  return `(threshold: ${indicatorPart}${threshold})`;
}

/** Build the intro banner reflecting the scopes being audited. */
function formatIntroBanner(
  scopes: AuditScope[],
  style: OutputStyle,
  thresholds?: Partial<Record<AuditScope, SeverityThreshold>>,
): string {
  const first = scopes[0];
  // `first` is always defined here; the guard narrows for TypeScript.
  if (scopes.length === 1 && first !== undefined) {
    const annotation = formatThresholdAnnotation(thresholds?.[first], style);
    const message = `Auditing ${SCOPE_NAMES[first]} dependencies${annotation && ` ${annotation}`} ...`;
    return formatGlyphLine(V11Y_GLYPHS, style, 'audit', message);
  }
  return formatGlyphLine(V11Y_GLYPHS, style, 'audit', 'Auditing dependencies ...');
}

/** Build the severity suffix for a finding line, e.g. `  🔴 critical`. */
export function formatSeveritySuffix(severity: string | undefined, style: OutputStyle): string {
  if (severity === undefined || severity === '') return '';
  const emoji = severityIndicator(severity, style);
  const emojiPart = emoji.length > 0 ? `${emoji} ` : '';
  return `  ${emojiPart}${severity}`;
}

/** Build the "allowed since X ago (datetime)" suffix for entries with `addedAt`. */
function formatAllowedSuffix(addedAt: string, now: Date): string {
  const relative = formatRelativeTime(addedAt, now);
  if (relative.length === 0) return ` \u{2022} allowed (${addedAt})`;
  return ` \u{2022} allowed since ${relative} (${addedAt})`;
}

/** Format a single unallowed vulnerability as a bullet line. */
function formatUnallowedLine(vuln: AuditResult, style: OutputStyle): string {
  const message = `${displayId(vuln)}: ${vuln.path}${formatSeveritySuffix(vuln.severity, style)}`;
  return `  \u{2022} ${formatMarkedLine(style, 'failed', message)}`;
}

/** Format a single allowed vulnerability as a bullet line. */
function formatAllowedLine(vuln: AllowedVuln, now: Date, style: OutputStyle): string {
  const suffix = vuln.addedAt !== undefined ? formatAllowedSuffix(vuln.addedAt, now) : '';
  const message = `${displayId(vuln)}: ${vuln.path}${formatSeveritySuffix(vuln.severity, style)}${suffix}`;
  return `  \u{2022} ${formatMarkedLine(style, 'passed', message)}`;
}

/** Format a single stale entry as a bullet line. */
function formatStaleLine(entry: StaleEntry, style: OutputStyle): string {
  return `  \u{2022} ${formatMarkedLine(style, 'stale', `${entry.id} \u{2022} not needed`)}`;
}

/** Format a single below-threshold vulnerability as a bullet line. */
function formatBelowThresholdLine(vuln: AuditResult, style: OutputStyle): string {
  const message = `${displayId(vuln)}: ${vuln.path}${formatSeveritySuffix(vuln.severity, style)} \u{2022} ignored`;
  return `  \u{2022} ${formatMarkedLine(style, 'skipped', message)}`;
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
function formatScopeFindings(result: ScopeCheckResult, now: Date, style: OutputStyle): string[] {
  const lines: string[] = Array.from(result.unallowed, (vuln) => formatUnallowedLine(vuln, style));
  for (const vuln of result.allowed) {
    lines.push(formatAllowedLine(vuln, now, style));
  }
  for (const entry of result.stale) {
    lines.push(formatStaleLine(entry, style));
  }
  for (const vuln of result.belowThreshold) {
    lines.push(formatBelowThresholdLine(vuln, style));
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
  style: OutputStyle,
  now?: Date,
  thresholds?: Partial<Record<AuditScope, SeverityThreshold>>,
): string {
  const effectiveNow = now ?? new Date();
  const lines: string[] = [formatIntroBanner(scopes, style, thresholds)];

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
    lines.push(...formatScopeFindings(scopeResult, effectiveNow, style));
    const actions = formatActionHints(result, scopes);
    if (actions.length > 0) {
      lines.push('', ...actions.split('\n').filter((l) => l.length > 0));
    }
    return lines.join('\n') + '\n';
  }

  // Multiple scopes: show scope headers.
  for (const scope of scopes) {
    const scopeResult = result[scope];
    const annotation = formatThresholdAnnotation(thresholds?.[scope], style);
    const label = formatGlyphLine(V11Y_GLYPHS, style, SCOPE_GLYPH_NAMES[scope], `${SCOPE_NAMES[scope]}:`);
    lines.push(`  ${label}${annotation && ` ${annotation}`}`);
    if (hasFindings(scopeResult)) {
      lines.push(...formatScopeFindings(scopeResult, effectiveNow, style));
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

/** Format check results as a JSON string with a top-level `summary` block derived from the result. */
export function formatCheckJson(result: CheckResult, scopes: AuditScope[]): string {
  const output: Record<string, unknown> = {};
  for (const scope of scopes) {
    output[scope] = result[scope];
  }
  output['summary'] = deriveSummary(result, scopes);
  return JSON.stringify(output, null, 2) + '\n';
}
