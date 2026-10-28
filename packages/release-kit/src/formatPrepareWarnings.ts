import { formatStatusLine, type OutputStyle, truncateToWidth } from '@williamthorsen/nmr-core';

import type { PolicyViolation, PrepareResult, ReleasedPackageResult } from './types.ts';

/** The rendered width to which the report cuts a commit subject, wherever it prints one. */
const SUBJECT_BUDGET_COLUMNS = 72;

/**
 * Appends warning lines for the change-record blocks that could not be read, the entries whose type is undeclared, and
 * the entry scopes that don't match any workspace in the commit's window.
 *
 * `indent` follows the same convention as {@link formatUnparseableWarning}.
 */
export function formatChangeRecordWarnings(
  lines: string[],
  release: Pick<ReleasedPackageResult, 'malformedBlocks' | 'undeclaredEntryTypes' | 'unroutedEntryScopes'>,
  style: OutputStyle,
  indent = '',
): void {
  const { malformedBlocks = [], undeclaredEntryTypes = [], unroutedEntryScopes = [] } = release;
  if (malformedBlocks.length > 0) {
    const count = malformedBlocks.length;
    const header = `${count} change-record block${count === 1 ? '' : 's'} could not be read (item taken from the title)`;
    lines.push(`${indent}  ${formatStatusLine(style, 'warning', `${header}:`)}`);
    for (const block of malformedBlocks) {
      lines.push(
        `${indent}    · ${block.commitHash.slice(0, 7)} '${truncateSubject(block.commitSubject)}': ${block.reason}`,
      );
    }
  }
  if (undeclaredEntryTypes.length > 0) {
    const count = undeclaredEntryTypes.length;
    const header = `${count} change-record entr${count === 1 ? 'y has an' : 'ies have'} undeclared type${count === 1 ? '' : 's'} (no item)`;
    lines.push(`${indent}  ${formatStatusLine(style, 'warning', `${header}:`)}`);
    for (const entry of undeclaredEntryTypes) {
      const shortHash = entry.commitHash.slice(0, 7);
      lines.push(
        `${indent}    · ${shortHash} '${truncateSubject(entry.commitSubject)}': type '${entry.type}' at entry ${entry.entryPosition}`,
      );
    }
  }
  if (unroutedEntryScopes.length === 0) {
    return;
  }
  const count = unroutedEntryScopes.length;
  const header = `${count} change-record entry scope${count === 1 ? ' does not match' : 's do not match'} any workspace in the commit's window (no item there)`;
  lines.push(`${indent}  ${formatStatusLine(style, 'warning', `${header}:`)}`);
  for (const finding of unroutedEntryScopes) {
    const shortHash = finding.commitHash.slice(0, 7);
    lines.push(
      `${indent}    · ${shortHash} '${truncateSubject(finding.commitSubject)}': scope '${finding.scope}' at entry ${finding.entryPosition}`,
    );
  }
}

/**
 * Appends policy-violation lines when applicable: one header line plus one bullet per violation.
 *
 * `indent` follows the same convention as {@link formatUnparseableWarning}.
 */
export function formatPolicyViolations(
  lines: string[],
  violations: PolicyViolation[] | undefined,
  style: OutputStyle,
  indent = '',
): void {
  if (violations === undefined || violations.length === 0) {
    return;
  }

  const count = violations.length;
  lines.push(`${indent}  ${formatStatusLine(style, 'warning', `${count} policy violation${count === 1 ? '' : 's'}:`)}`);
  for (const violation of violations) {
    const shortHash = violation.commitHash.slice(0, 7);
    const subject = violation.commitSubject;
    const truncatedSubject = truncateSubject(subject);
    const location =
      violation.surface === 'entry' ? `entry ${violation.entryPosition ?? '?'}` : `${violation.surface} surface`;
    lines.push(`${indent}    · ${shortHash} '${truncatedSubject}': type '${violation.type}' at ${location}`);
  }
}

/**
 * Appends unparseable commit warning lines when applicable.
 *
 * `indent` is an additional outer indent prepended to both the header and bullet lines; base
 * spacing (2 spaces for the header, 4 for bullets) is encoded in the format strings, so the
 * caller passes only the section-level indent (e.g., `''` for single-package, `'  '` for
 * multi-workspace).
 */
export function formatUnparseableWarning(
  lines: string[],
  release: Pick<ReleasedPackageResult, 'unparseableCommits'>,
  style: OutputStyle,
  indent = '',
): void {
  const unparseableCommits = release.unparseableCommits;
  if (unparseableCommits === undefined || unparseableCommits.length === 0) {
    return;
  }

  const count = unparseableCommits.length;
  lines.push(
    `${indent}  ${formatStatusLine(style, 'warning', `${count} commit${count === 1 ? '' : 's'} could not be parsed`)}`,
  );

  for (const commit of unparseableCommits) {
    const shortHash = commit.hash.slice(0, 7);
    const truncatedSubject = truncateSubject(commit.subject);
    lines.push(`${indent}    · ${shortHash} ${truncatedSubject}`);
  }
}

/** Appends warning lines when the prepare result includes warnings. */
export function formatWarnings(lines: string[], result: PrepareResult, style: OutputStyle): void {
  const { warnings } = result;
  if (warnings === undefined || warnings.length === 0) {
    return;
  }

  lines.push('');
  for (const warning of warnings) {
    lines.push(formatStatusLine(style, 'warning', warning));
  }
}

// region | Helpers

/** Cuts a commit subject to the report's column budget, marking the cut with `truncateToWidth`'s default ellipsis. */
function truncateSubject(subject: string): string {
  return truncateToWidth(subject, { width: SUBJECT_BUDGET_COLUMNS });
}

// endregion | Helpers
