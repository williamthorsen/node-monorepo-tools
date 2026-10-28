import type { BumpSignal } from './determineBumpType.ts';
import type { RawCommit } from './enumerateReleaseWindows.ts';
import { extractMigration } from './extractMigration.ts';
import { type ChangeRecordEntry, stripChangeRecordBlocks } from './parseChangeRecordBlock.ts';
import { evaluateBreakingPolicy, parseSubject, resolveType } from './parseCommitMessage.ts';
import type {
  ChangelogItem,
  MalformedChangeRecordBlock,
  PolicyViolation,
  ReleaseSettings,
  UndeclaredEntryType,
  UnroutedEntryScope,
  VersionPatterns,
  WorkTypeConfig,
} from './types.ts';

/**
 * Regex patterns for trailer lines to strip from the tail of a commit body.
 *
 * The patterns don't match `Migration:`. `extractMigration` reads the stripped body, so a pattern
 * matching the label would take the label line off a body-final `Migration:` paragraph and
 * silently stop yielding `item.migration`.
 */
const TRAILER_PATTERNS: RegExp[] = [
  /^Change:/i,
  /^Signed-off-by:/i,
  /^Co-authored-by:/i,
  /^(Closes|Fixes|Resolves)\s+#\d+\s*$/i,
  /^https?:\/\/\S+\/pull\/\d+\/?\s*$/,
];

/**
 * Builds the item that one change-record entry yields, with the section header that its type declares.
 *
 * Returns `undefined` for an entry whose scopes route it away from the workspace being read, for one whose type is
 * undeclared, which is recorded as a diagnostic, and for one whose type is excluded from the changelog. An entry
 * whose `breaking` violates its type's policy is recorded as a policy violation and yields an item that is not
 * breaking.
 */
export function buildEntryItem(
  commit: RawCommit,
  entry: ChangeRecordEntry,
  position: number,
  prNumber: number | undefined,
  context: ReadContext,
  diagnostics: ChangelogDiagnostics | undefined,
): DerivedItem | undefined {
  const { breakingPolicies, routing, workTypes } = context;
  if (routing !== undefined && !isRoutedTo(entry.scopes, routing)) {
    return undefined;
  }
  const type = resolveType(entry.type, workTypes);
  if (type === undefined) {
    diagnostics?.undeclaredEntryTypes.push({
      commitHash: commit.hash,
      commitSubject: commit.subject,
      entryPosition: position,
      type: entry.type,
    });
    return undefined;
  }
  const config = workTypes[type];
  if (config === undefined || config.excludedFromChangelog === true) {
    return undefined;
  }

  const breaking = evaluateBreakingPolicy({
    commit: { message: commit.message, subject: commit.subject, hash: commit.hash },
    resolvedType: type,
    hasPrefixBreaking: entry.breaking,
    hasFooterBreaking: false,
    policy: breakingPolicies[type] ?? 'optional',
    prefixSurface: 'entry',
    onPolicyViolation:
      diagnostics === undefined
        ? undefined
        : (violatingCommit, violatedType, surface) => {
            diagnostics.policyViolations.push({
              commitHash: violatingCommit.hash,
              commitSubject: violatingCommit.subject,
              type: violatedType,
              surface,
              entryPosition: position,
            });
          },
  });

  const item: ChangelogItem = {
    description: prNumber === undefined ? entry.text : `${entry.text} (#${prNumber})`,
  };
  if (breaking) {
    item.breaking = true;
  }
  if (entry.migration !== undefined) {
    item.migration = entry.migration;
  }
  item.hash = commit.hash;
  item.entry = position;
  return { header: config.header, item, signal: { type, breaking } };
}

/**
 * Builds the item that a commit without a usable change-record block yields from its title and body. The body leaves
 * out any block, which records data rather than prose.
 *
 * `isParsedBreaking` is the parser's policy-evaluated flag. The item is breaking only when the subject also has a
 * prefix `!`, because the parse also counts a `BREAKING CHANGE:` footer on an `optional`-policy type, which the
 * changelog ignores.
 */
export function buildTitleItem(
  commit: RawCommit,
  isParsedBreaking: boolean,
  workTypes: Record<string, WorkTypeConfig>,
): ChangelogItem {
  const body = extractBody(stripChangeRecordBlocks(commit.message));
  const item: ChangelogItem = { description: extractDescription(commit.message) };
  if (body !== undefined) {
    item.body = body;
  }
  if (isParsedBreaking && hasBreakingMarkerInSubject(commit.message, workTypes)) {
    item.breaking = true;
  }
  // Derive from the trailer-stripped body so that the migration comes from exactly the text in `body`.
  const migration = extractMigration(body);
  if (migration !== undefined) {
    item.migration = migration;
  }
  item.hash = commit.hash;
  return item;
}

/** What reading the unreleased window reports beyond its items. */
export interface ChangelogDiagnostics {
  malformedBlocks: MalformedChangeRecordBlock[];
  /** Breaking-policy violations of the window's titles and change-record entries. */
  policyViolations: PolicyViolation[];
  undeclaredEntryTypes: UndeclaredEntryType[];
  /**
   * Entry scopes that don't route to any workspace. A read leaves it empty: Only a pass over every workspace can fill
   * it.
   */
  unroutedEntryScopes: UnroutedEntryScope[];
}

/** An item with the section header under which it is filed and the signal that it contributes to the bump. */
export interface DerivedItem {
  header: string;
  item: ChangelogItem;
  signal: BumpSignal;
}

/** Reports whether any of `entries` is routed to the workspace of `routing`; always true for a read without routing. */
export function hasRoutedEntry(entries: readonly ChangeRecordEntry[], routing: EntryRouting | undefined): boolean {
  return routing === undefined || entries.some((entry) => isRoutedTo(entry.scopes, routing));
}

/** What every window's read shares. */
export interface ReadContext {
  breakingPolicies: NonNullable<ReleaseSettings['breakingPolicies']>;
  /** Dev-only section titles, stripped of decorations. */
  devOnlySections: ReadonlySet<string>;
  /** The workspace to which entries are routed; undefined for a read that takes every entry. */
  routing?: EntryRouting;
  versionPatterns: VersionPatterns;
  workTypes: NonNullable<ReleaseSettings['workTypes']>;
}

// region | Helpers

/** The scope of the workspace to which a read routes change-record entries, and the aliases that resolve scopes. */
interface EntryRouting {
  scope: string;
  scopeAliases: Readonly<Record<string, string>>;
}

/**
 * Extracts the body from a commit message: the lines after the subject, less its leading blank lines and the blank
 * and trailer lines at its end; undefined when nothing remains.
 */
function extractBody(message: string): string | undefined {
  const lines = message.split('\n').slice(1);

  // Skip leading blank lines.
  let start = 0;
  while (start < lines.length && (lines[start] ?? '').trim() === '') {
    start += 1;
  }

  // Walk backward, dropping blank lines and trailer-matching lines from the tail.
  let end = lines.length;
  while (end > start) {
    const line = lines[end - 1] ?? '';
    const trimmedLine = line.trim();
    if (trimmedLine === '') {
      end -= 1;
      continue;
    }
    if (TRAILER_PATTERNS.some((pattern) => pattern.test(trimmedLine))) {
      end -= 1;
      continue;
    }
    break;
  }

  if (end <= start) {
    return undefined;
  }

  return lines.slice(start, end).join('\n').trim();
}

/** Extracts the description from a commit subject: the text after its first `: `, capitalized. */
function extractDescription(message: string): string {
  const firstLine = message.split('\n', 1)[0] ?? message;
  const descriptionText = firstLine.split(': ').slice(1).join(': ');
  return descriptionText.charAt(0).toUpperCase() + descriptionText.slice(1);
}

/**
 * Reports whether the commit subject contains the `!` breaking marker, as change-grammar reads it. The `BREAKING
 * CHANGE:` body footer is not considered, and the marker alone does not make an item breaking: The commit's work-type
 * policy must also permit `!` (see `buildTitleItem`).
 */
function hasBreakingMarkerInSubject(message: string, workTypes: Record<string, WorkTypeConfig>): boolean {
  return parseSubject(message.split('\n', 1)[0] ?? '', workTypes)?.breaking === true;
}

/**
 * Reports whether an entry with `scopes` is routed to the workspace of `routing`: Its scopes are empty, contain `*`,
 * or name the workspace's scope once `scopeAliases` resolves them.
 */
function isRoutedTo(scopes: readonly string[], routing: EntryRouting): boolean {
  if (scopes.length === 0) {
    return true;
  }
  return scopes.some((scope) => {
    const resolvedScope = routing.scopeAliases[scope] ?? scope;
    return resolvedScope === '*' || resolvedScope === routing.scope;
  });
}

// endregion | Helpers
