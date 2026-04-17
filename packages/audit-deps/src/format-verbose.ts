import { formatActionHints } from './format-actions.ts';
import type { AllowedVuln, CheckResult, ScopeCheckResult, StaleEntry } from './format-check.ts';
import { severityIndicator } from './format-check.ts';
import { formatRelativeTime } from './format-time.ts';
import type { AuditResult, AuditScope } from './types.ts';

export { formatRelativeTime } from './format-time.ts';

// ---------------------------------------------------------------------------
// Display constants
// ---------------------------------------------------------------------------

const STATUS_UNALLOWED = '\u{1F6A8}';
const STATUS_ALLOWED = '\u{26A0}\u{FE0F}';
const STATUS_STALE = '\u{1F5D1}\u{FE0F}';

/** Scope display metadata. */
const SCOPE_HEADERS: Record<AuditScope, string> = {
  prod: '-- \u{1F4E6} prod --',
  dev: '-- \u{1F527} dev --',
};

/** Indentation for entry detail lines (below the marker + id line). */
const DETAIL_INDENT = '     ';

/** Approximate target width for wrapped description lines. */
const WRAP_COLUMNS = 72;

// ---------------------------------------------------------------------------
// Text formatter
// ---------------------------------------------------------------------------

/** Format the verbose per-vulnerability check output as text. */
export function formatCheckVerboseText(result: CheckResult, scopes: AuditScope[], now?: Date): string {
  const effectiveNow = now ?? new Date();
  const sections: string[] = [];

  for (const scope of scopes) {
    sections.push(formatScopeVerbose(scope, result[scope], effectiveNow));
  }

  return sections.join('\n\n') + '\n' + formatActionHints(result, scopes);
}

/** Format a single scope's verbose check results. */
function formatScopeVerbose(scope: AuditScope, result: ScopeCheckResult, now: Date): string {
  const lines: string[] = [SCOPE_HEADERS[scope]];
  const hasFindings = result.unallowed.length > 0 || result.allowed.length > 0 || result.stale.length > 0;

  if (!hasFindings) {
    lines.push('  (none)');
    return lines.join('\n');
  }

  const blocks: string[] = [];
  for (const vuln of result.unallowed) {
    blocks.push(formatUnallowedBlock(vuln));
  }
  for (const vuln of result.allowed) {
    blocks.push(formatAllowedBlock(vuln, now));
  }
  for (const entry of result.stale) {
    blocks.push(formatStaleLine(entry));
  }

  // Join blocks with a blank line between them.
  return lines.concat(blocks.join('\n\n')).join('\n');
}

/** Resolve the best display ID for a vulnerability: GHSA ID if available, otherwise the numeric ID. */
function displayId(vuln: { ghsaId?: string | undefined; id: string }): string {
  return vuln.ghsaId ?? vuln.id;
}

/** Format an unallowed vulnerability block with 🚨 marker. */
function formatUnallowedBlock(vuln: AuditResult): string {
  const headerLine = `  ${STATUS_UNALLOWED} ${displayId(vuln)}${formatSeveritySuffix(vuln.severity)}`;
  const detail = formatAdvisoryDetail(vuln);
  return [headerLine, ...detail].join('\n');
}

/** Format an allowed vulnerability block with ⚠️ marker plus reason/addedAt context. */
function formatAllowedBlock(vuln: AllowedVuln, now: Date): string {
  const allowedSuffix = vuln.addedAt !== undefined ? formatAllowedSuffix(vuln.addedAt, now) : '';
  const headerLine = `  ${STATUS_ALLOWED} ${displayId(vuln)}${formatSeveritySuffix(vuln.severity)}${allowedSuffix}`;
  const hasTitle = vuln.title !== undefined;
  const detail = formatAdvisoryDetail(vuln);
  if (vuln.reason !== undefined) {
    const reasonLineIndex = findReasonInsertionIndex(hasTitle);
    detail.splice(reasonLineIndex, 0, `${DETAIL_INDENT}reason: ${vuln.reason}`);
  }
  return [headerLine, ...detail].join('\n');
}

/** Format a stale entry as a single line with 🗑️ marker. */
function formatStaleLine(entry: StaleEntry): string {
  return `  ${STATUS_STALE} ${entry.id}  not needed`;
}

/** Shared advisory detail lines (title, paths, link, description) for unallowed or allowed entries. */
function formatAdvisoryDetail(vuln: {
  description?: string | undefined;
  paths: string[];
  title?: string | undefined;
  url: string;
}): string[] {
  const lines: string[] = [];
  if (vuln.title !== undefined) {
    lines.push(`${DETAIL_INDENT}${vuln.title}`);
  }
  lines.push(...formatPathsLines(vuln.paths), `${DETAIL_INDENT}link: ${vuln.url}`);
  if (vuln.description !== undefined) {
    lines.push('', ...formatDescriptionLines(vuln.description));
  }
  return lines;
}

/** Find the index at which to insert the `reason:` line: just after the title (or at top if no title). */
function findReasonInsertionIndex(hasTitle: boolean): number {
  // Title, when present, is the first detail line. Reason goes right after it so the advisory block
  // reads: id header, title, reason, paths, link, description.
  return hasTitle ? 1 : 0;
}

/** Build `path:` or `paths:` lines for a single or multiple paths. */
function formatPathsLines(paths: string[]): string[] {
  if (paths.length === 0) return [];
  if (paths.length === 1) {
    return [`${DETAIL_INDENT}path: ${paths[0]}`];
  }
  const lines = [`${DETAIL_INDENT}paths:`];
  for (const pathValue of paths) {
    lines.push(`${DETAIL_INDENT}  - ${pathValue}`);
  }
  return lines;
}

/** Build the severity suffix like `  🔴 high` (leading two spaces separator). */
function formatSeveritySuffix(severity: string | undefined): string {
  if (severity === undefined || severity === '') return '';
  const emoji = severityIndicator(severity);
  const emojiPart = emoji.length > 0 ? `${emoji} ` : '';
  return `  ${emojiPart}${severity}`;
}

/** Build the "allowed X ago (datetime)" suffix for entries with `addedAt`. */
function formatAllowedSuffix(addedAt: string, now: Date): string {
  const relative = formatRelativeTime(addedAt, now);
  if (relative.length === 0) return `  allowed (${addedAt})`;
  return `  allowed ${relative} (${addedAt})`;
}

/** Wrap a description (possibly multi-paragraph) to the detail indent. */
function formatDescriptionLines(description: string): string[] {
  const paragraphs = description.split(/\n\s*\n/);
  const lines: string[] = [];
  let needsSeparator = false;
  for (const paragraph of paragraphs) {
    if (needsSeparator) lines.push('');
    const wrapped = wrapParagraph(paragraph.trim(), WRAP_COLUMNS);
    for (const wrappedLine of wrapped) {
      lines.push(`${DETAIL_INDENT}${wrappedLine}`);
    }
    needsSeparator = true;
  }
  return lines;
}

/** Word-wrap a single paragraph to the given column width. */
function wrapParagraph(paragraph: string, columns: number): string[] {
  if (paragraph.length === 0) return [];
  const words = paragraph.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current === '') {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length > columns) {
      lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}
