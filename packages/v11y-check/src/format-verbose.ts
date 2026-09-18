import { formatGlyphLine, type OutputStyle, wrapToWidth } from '@williamthorsen/nmr-core';

import { formatActionHints } from './format-actions.ts';
import {
  type AllowedVuln,
  type CheckResult,
  displayId,
  formatSeveritySuffix,
  type ScopeCheckResult,
  severityIndicator,
  type StaleEntry,
} from './format-check.ts';
import { formatRelativeTime } from './format-time.ts';
import { formatMarkedLine, measureRowMarkerColumn, V11Y_GLYPHS, type V11yGlyphName } from './glyphs.ts';
import type { AuditResult, AuditScope, SeverityThreshold } from './types.ts';

// ---------------------------------------------------------------------------
// Display constants
// ---------------------------------------------------------------------------

const SCOPE_GLYPH_NAMES: Record<AuditScope, V11yGlyphName> = {
  dev: 'scopeDev',
  prod: 'scopeProd',
};

/** Indentation of a block's header line, ahead of its row marker. */
const MARKER_INDENT = '  ';

/** Target width, in display columns, of a wrapped description line's content. */
const WRAP_COLUMNS = 72;

// ---------------------------------------------------------------------------
// Text formatter
// ---------------------------------------------------------------------------

/** Format the verbose per-vulnerability check output as text. */
export function formatCheckVerboseText(
  result: CheckResult,
  scopes: AuditScope[],
  style: OutputStyle,
  now?: Date,
  thresholds?: Partial<Record<AuditScope, SeverityThreshold>>,
): string {
  const effectiveNow = now ?? new Date();
  const sections: string[] = Array.from(scopes, (scope) =>
    formatScopeVerbose(scope, result[scope], effectiveNow, style, thresholds?.[scope]),
  );

  const actions = formatActionHints(result, scopes);
  const body = sections.join('\n\n') + '\n';
  if (actions.length === 0) return body;
  return body + '\n' + actions + '\n';
}

/** Format a threshold annotation for scope headers. Returns empty string for `low` or undefined threshold. */
function formatThresholdSuffix(threshold: SeverityThreshold | undefined, style: OutputStyle): string {
  if (threshold === undefined || threshold === 'low') return '';
  const indicator = severityIndicator(threshold, style);
  const indicatorPart = indicator.length > 0 ? `${indicator} ` : '';
  return ` (threshold: ${indicatorPart}${threshold})`;
}

/** Format a single scope's verbose check results. */
function formatScopeVerbose(
  scope: AuditScope,
  result: ScopeCheckResult,
  now: Date,
  style: OutputStyle,
  threshold?: SeverityThreshold,
): string {
  const thresholdSuffix = formatThresholdSuffix(threshold, style);
  const lines: string[] = [
    `-- ${formatGlyphLine(V11Y_GLYPHS, style, SCOPE_GLYPH_NAMES[scope], scope)} --${thresholdSuffix}`,
  ];
  const hasFindings =
    result.unallowed.length > 0 ||
    result.allowed.length > 0 ||
    result.stale.length > 0 ||
    result.belowThreshold.length > 0;

  if (!hasFindings) {
    lines.push('  (none)');
    return lines.join('\n');
  }

  const blocks: string[] = Array.from(result.unallowed, (vuln) => formatUnallowedBlock(vuln, style));
  for (const vuln of result.allowed) {
    blocks.push(formatAllowedBlock(vuln, now, style));
  }
  for (const entry of result.stale) {
    blocks.push(formatStaleLine(entry, style));
  }
  for (const vuln of result.belowThreshold) {
    blocks.push(formatBelowThresholdBlock(vuln, style));
  }

  // Join blocks with a blank line between them.
  return lines.concat(blocks.join('\n\n')).join('\n');
}

/** Formats an unallowed vulnerability block with the `failed` marker. */
function formatUnallowedBlock(vuln: AuditResult, style: OutputStyle): string {
  const message = `${displayId(vuln)}${formatSeveritySuffix(vuln.severity, style)}`;
  const headerLine = `${MARKER_INDENT}${formatMarkedLine(style, 'failed', message)}`;
  const detail = formatAdvisoryDetail(vuln, style);
  return [headerLine, ...detail].join('\n');
}

/** Formats an allowed vulnerability block with the `passed` marker plus reason/addedAt context. */
function formatAllowedBlock(vuln: AllowedVuln, now: Date, style: OutputStyle): string {
  const allowedSuffix = vuln.addedAt !== undefined ? formatAllowedSuffix(vuln.addedAt, now) : '';
  const message = `${displayId(vuln)}${formatSeveritySuffix(vuln.severity, style)}${allowedSuffix}`;
  const headerLine = `${MARKER_INDENT}${formatMarkedLine(style, 'passed', message)}`;
  const hasTitle = vuln.title !== undefined;
  const detail = formatAdvisoryDetail(vuln, style);
  if (vuln.reason !== undefined) {
    const reasonLineIndex = findReasonInsertionIndex(hasTitle);
    detail.splice(reasonLineIndex, 0, `${buildDetailIndent(style)}reason: ${vuln.reason}`);
  }
  return [headerLine, ...detail].join('\n');
}

/** Formats a stale entry as a single line with the `stale` marker. */
function formatStaleLine(entry: StaleEntry, style: OutputStyle): string {
  return `${MARKER_INDENT}${formatMarkedLine(style, 'stale', `${entry.id}  not needed`)}`;
}

/** Formats a below-threshold vulnerability block with the `skipped` marker and "ignored (below threshold)" annotation. */
function formatBelowThresholdBlock(vuln: AuditResult, style: OutputStyle): string {
  const message = `${displayId(vuln)}${formatSeveritySuffix(vuln.severity, style)}  ignored (below threshold)`;
  const headerLine = `${MARKER_INDENT}${formatMarkedLine(style, 'skipped', message)}`;
  const detail = formatAdvisoryDetail(vuln, style);
  return [headerLine, ...detail].join('\n');
}

/** Shared advisory detail lines (title, paths, link, description) for unallowed or allowed entries. */
function formatAdvisoryDetail(
  vuln: {
    description?: string | undefined;
    paths: string[];
    title?: string | undefined;
    url: string;
  },
  style: OutputStyle,
): string[] {
  const detailIndent = buildDetailIndent(style);
  const lines: string[] = [];
  if (vuln.title !== undefined) {
    lines.push(`${detailIndent}${vuln.title}`);
  }
  lines.push(...formatPathsLines(vuln.paths, detailIndent), `${detailIndent}link: ${vuln.url}`);
  if (vuln.description !== undefined) {
    lines.push('', ...formatDescriptionLines(vuln.description, detailIndent));
  }
  return lines;
}

/** Builds the indentation that puts an entry's detail lines under the text that follows its row marker. */
function buildDetailIndent(style: OutputStyle): string {
  return ' '.repeat(MARKER_INDENT.length + measureRowMarkerColumn(style) + 1);
}

/** Find the index at which to insert the `reason:` line: just after the title (or at top if no title). */
function findReasonInsertionIndex(hasTitle: boolean): number {
  // Title, when present, is the first detail line. Reason goes right after it so the advisory block
  // reads: id header, title, reason, paths, link, description.
  return hasTitle ? 1 : 0;
}

/** Build `path:` or `paths:` lines for a single or multiple paths. */
function formatPathsLines(paths: string[], detailIndent: string): string[] {
  if (paths.length === 0) return [];
  if (paths.length === 1) {
    return [`${detailIndent}path: ${paths[0]}`];
  }
  const lines = [`${detailIndent}paths:`];
  for (const pathValue of paths) {
    lines.push(`${detailIndent}  - ${pathValue}`);
  }
  return lines;
}

/** Build the "allowed X ago (datetime)" suffix for entries with `addedAt`. */
function formatAllowedSuffix(addedAt: string, now: Date): string {
  const relative = formatRelativeTime(addedAt, now);
  if (relative.length === 0) return `  allowed (${addedAt})`;
  return `  allowed ${relative} (${addedAt})`;
}

/** Wraps a description (possibly multi-paragraph) by display columns, indenting every line to the detail indent. */
function formatDescriptionLines(description: string, detailIndent: string): string[] {
  const paragraphs = description.split(/\n\s*\n/);
  const lines: string[] = [];
  let needsSeparator = false;
  for (const paragraph of paragraphs) {
    if (needsSeparator) lines.push('');
    // `wrapToWidth` counts the indent inside `width`, and `WRAP_COLUMNS` is the width of the content alone.
    const wrapped = wrapToWidth(paragraph, { indent: detailIndent.length, width: WRAP_COLUMNS + detailIndent.length });
    if (wrapped !== '') lines.push(...wrapped.split('\n'));
    needsSeparator = true;
  }
  return lines;
}
