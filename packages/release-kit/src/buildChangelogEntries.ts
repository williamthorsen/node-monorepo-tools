import { chainError } from '@williamthorsen/toolbelt.errors/candidate';

import { extractVersion } from './changelogJsonUtils.ts';
import { classifyChangelogCommit, isNonChangeSubject } from './classifyChangelogCommit.ts';
import { DEFAULT_BREAKING_POLICIES, DEFAULT_WORK_TYPES } from './defaults.ts';
import { enumerateReleaseWindows, type RawCommit, type ReleaseWindow } from './enumerateReleaseWindows.ts';
import { extractMigration } from './extractMigration.ts';
import type { GenerateChangelogOptions } from './generateChangelogs.ts';
import { type ChangeRecordEntry, parseChangeRecordBlock, stripChangeRecordBlocks } from './parseChangeRecordBlock.ts';
import {
  COMMIT_PREPROCESSOR_PATTERNS,
  evaluateBreakingPolicy,
  parseCommitMessage,
  PIPE_SCOPE_SOURCE,
  resolveType,
} from './parseCommitMessage.ts';
import { stripEmojiPrefix } from './stripEmojiPrefix.ts';
import type {
  ChangelogEntry,
  ChangelogItem,
  ChangelogSection,
  MalformedChangeRecordBlock,
  PolicyViolation,
  ReleaseConfig,
  UndeclaredEntryType,
} from './types.ts';

/**
 * Canonical bare-section-name → priority index, derived from `DEFAULT_WORK_TYPES`.
 *
 * Used to sort `ChangelogEntry.sections` into canonical order so the structured
 * `changelog.json` artifact emits sections in tier-then-row order regardless of which
 * commit was encountered first. Render-time consumers (`renderReleaseNotesSingle`) accept
 * an explicit `sectionOrder`, but downstream tools that read `changelog.json` directly
 * depend on this in-order serialisation.
 *
 * Headers in `DEFAULT_WORK_TYPES` carry the canonical emoji-prefixed form
 * (e.g. `🐛 Bug fixes`); the bare key is used so the index matches both the decorated titles
 * `transformReleases` assigns and the bare names a consumer's `workTypes` override may supply.
 */
const CANONICAL_SECTION_ORDER: ReadonlyMap<string, number> = new Map(
  Object.values(DEFAULT_WORK_TYPES).map((config, index) => [stripGroupDecorations(config.header), index]),
);

/** Lookup the canonical priority of a section title. Unknown sections sort to the end. */
function canonicalSectionPriority(title: string): number {
  const index = CANONICAL_SECTION_ORDER.get(stripGroupDecorations(title));
  return index ?? Infinity;
}

/**
 * Strips a section title down to its bare name.
 *
 * A default title carries a leading emoji (e.g. `"🐛 Bug fixes"`), while a consumer's
 * `devOnlySections` or `workTypes` override may be written as a bare name. Comparing both sides
 * through this helper lets the two forms match.
 */
export function stripGroupDecorations(group: string): string {
  return stripEmojiPrefix(group);
}

/**
 * Builds structured changelog entries from the release windows of git history.
 *
 * Pure data: reads the windows from `enumerateReleaseWindows`, the reader that the bump path also
 * uses, and returns the transformed `ChangelogEntry[]` with the diagnostics of the unreleased window.
 * Performs no `changelog.json` I/O; callers persist the entries via `renderChangelogJson`.
 *
 * `tag` names the unreleased window, which holds the commits that no matching tag contains.
 */
export function buildChangelogEntries(
  config: Pick<ReleaseConfig, 'breakingPolicies' | 'changelogJson' | 'workTypes'>,
  tag: string,
  options: GenerateChangelogOptions,
): { entries: ChangelogEntry[]; diagnostics: ChangelogDiagnostics } {
  try {
    const windows = enumerateReleaseWindows({
      ...(options.paths !== undefined && { paths: options.paths }),
      tagPrefixes: options.tagPrefixes,
      unreleasedTag: tag,
    });
    const devOnlySections = new Set(config.changelogJson.devOnlySections);
    const workTypes = config.workTypes ?? DEFAULT_WORK_TYPES;
    const breakingPolicies = config.breakingPolicies ?? DEFAULT_BREAKING_POLICIES;
    return transformReleases(windows, devOnlySections, workTypes, breakingPolicies);
  } catch (error: unknown) {
    throw chainError(`Failed to build changelog entries for tag ${tag}`, error);
  }
}

/** What the unreleased window's change-record blocks yielded that the release report shows. */
export interface ChangelogDiagnostics {
  malformedBlocks: MalformedChangeRecordBlock[];
  /** Breaking-policy violations of change-record entries, each with surface `'entry'`. */
  policyViolations: PolicyViolation[];
  undeclaredEntryTypes: UndeclaredEntryType[];
}

/**
 * Transforms release windows into `ChangelogEntry[]`.
 *
 * A commit whose last `change-record` block records entries yields one item per entry; any other commit is
 * classified by its title through `classifyChangelogCommit`. A `release:` or merge subject yields nothing either
 * way. A release left with no section contributes no entry. Only the first window, the unreleased one, records
 * diagnostics, since the released windows were reported when they were prepared.
 */
function transformReleases(
  releases: readonly ReleaseWindow[],
  devOnlySections: Set<string>,
  workTypes: NonNullable<ReleaseConfig['workTypes']>,
  breakingPolicies: NonNullable<ReleaseConfig['breakingPolicies']>,
): { entries: ChangelogEntry[]; diagnostics: ChangelogDiagnostics } {
  const entries: ChangelogEntry[] = [];
  const diagnostics: ChangelogDiagnostics = { malformedBlocks: [], policyViolations: [], undeclaredEntryTypes: [] };
  // Normalise dev-only entries once so consumer overrides written as bare names (e.g. `'Internal features'`)
  // match emoji-prefixed default titles (`🏗️ Internal features`) without requiring config updates.
  const devOnlyNormalised = new Set([...devOnlySections].map(stripGroupDecorations));

  for (const [index, release] of releases.entries()) {
    const version = extractVersion(release.version);
    const date = new Date(release.timestamp * 1_000).toISOString().slice(0, 10);
    const windowDiagnostics = index === 0 ? diagnostics : undefined;

    const sectionMap = new Map<string, ChangelogItem[]>();

    for (const commit of release.commits) {
      if (isNonChangeSubject(commit.subject)) {
        continue;
      }

      const reading = parseChangeRecordBlock(commit.message);
      if (reading.kind === 'malformed') {
        windowDiagnostics?.malformedBlocks.push({
          commitHash: commit.hash,
          commitSubject: commit.subject,
          reason: reading.reason,
        });
      }
      if (reading.kind === 'read' && reading.entries.length > 0) {
        for (const [entryIndex, entry] of reading.entries.entries()) {
          const derived = buildEntryItem(commit, entry, entryIndex + 1, reading.prNumber, {
            breakingPolicies,
            diagnostics: windowDiagnostics,
            workTypes,
          });
          if (derived !== undefined) {
            appendItem(sectionMap, derived.header, derived.item);
          }
        }
        continue;
      }

      const group = classifyChangelogCommit(commit.message, workTypes);
      if (group === undefined) {
        continue;
      }
      appendItem(sectionMap, group, buildTitleItem(commit, workTypes, breakingPolicies));
    }

    const sections: ChangelogSection[] = [];
    for (const [title, items] of sectionMap) {
      if (items.length === 0) {
        continue;
      }
      sections.push({
        title,
        audience: devOnlyNormalised.has(stripGroupDecorations(title)) ? 'dev' : 'all',
        items,
      });
    }

    // Sort by canonical priority so `changelog.json` emits sections in tier-then-row order.
    // Stable sort preserves encounter order for unknown sections (priority = Infinity).
    sections.sort((a, b) => canonicalSectionPriority(a.title) - canonicalSectionPriority(b.title));

    if (sections.length > 0) {
      entries.push({ version, date, sections });
    }
  }

  return { entries, diagnostics };
}

/** Adds an item to the section that `header` names, creating the section on first use. */
function appendItem(sectionMap: Map<string, ChangelogItem[]>, header: string, item: ChangelogItem): void {
  let items = sectionMap.get(header);
  if (items === undefined) {
    items = [];
    sectionMap.set(header, items);
  }
  items.push(item);
}

/**
 * Builds the item that one change-record entry yields, with the section header that its type declares.
 *
 * Returns `undefined` for an entry whose type is undeclared, which is recorded as a diagnostic, and for one whose
 * type is excluded from the changelog. An entry whose `breaking` violates its type's policy is recorded as a policy
 * violation and yields an item that is not breaking.
 */
function buildEntryItem(
  commit: RawCommit,
  entry: ChangeRecordEntry,
  position: number,
  prNumber: number | undefined,
  context: {
    breakingPolicies: NonNullable<ReleaseConfig['breakingPolicies']>;
    diagnostics: ChangelogDiagnostics | undefined;
    workTypes: NonNullable<ReleaseConfig['workTypes']>;
  },
): { header: string; item: ChangelogItem } | undefined {
  const { breakingPolicies, diagnostics, workTypes } = context;
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
        : (violating, violatedType, surface) => {
            diagnostics.policyViolations.push({
              commitHash: violating.hash,
              commitSubject: violating.subject,
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
  return { header: config.header, item };
}

/**
 * Builds the item that a commit without a usable change-record block yields from its title and body. The body leaves
 * out any block, which records data rather than prose.
 */
function buildTitleItem(
  commit: RawCommit,
  workTypes: NonNullable<ReleaseConfig['workTypes']>,
  breakingPolicies: NonNullable<ReleaseConfig['breakingPolicies']>,
): ChangelogItem {
  const body = extractBody(stripChangeRecordBlocks(commit.message));
  const item: ChangelogItem = { description: extractDescription(commit.message) };
  if (body !== undefined) {
    item.body = body;
  }
  if (isBreakingUnderPolicy(commit, workTypes, breakingPolicies)) {
    item.breaking = true;
  }
  // Derive from the trailer-stripped body rather than the raw message, so the field comes
  // from exactly the text that lands in `body`.
  const migration = extractMigration(body);
  if (migration !== undefined) {
    item.migration = migration;
  }
  item.hash = commit.hash;
  return item;
}

/**
 * Decides whether a commit's changelog item is breaking.
 *
 * The item is breaking when the subject carries a prefix `!` and the commit's work-type policy permits it, which keeps
 * the item in agreement with the version bump. The subject check comes first because the parse also counts a
 * `BREAKING CHANGE:` footer on an `optional`-policy type, which the changelog ignores.
 *
 * Every commit reaching this point resolved a type in `classifyChangelogCommit`, which parses against the same
 * `workTypes`; the parse here therefore succeeds, and the `?? true` satisfies the parser's nullable return.
 */
function isBreakingUnderPolicy(
  commit: RawCommit,
  workTypes: NonNullable<ReleaseConfig['workTypes']>,
  breakingPolicies: NonNullable<ReleaseConfig['breakingPolicies']>,
): boolean {
  if (!subjectHasBreakingMarker(commit.message)) {
    return false;
  }
  const parsed = parseCommitMessage(commit.message, commit.hash, workTypes, undefined, { breakingPolicies });
  return parsed?.breaking ?? true;
}

/** Matches a type-token with an optional scope (parenthesized or pipe-prefixed) followed by `!:`. */
const SUBJECT_BREAKING_MARKER_PATTERN = new RegExp(String.raw`^(?:${PIPE_SCOPE_SOURCE}\|)?\w+(?:\([^)]+\))?!:`);

/**
 * Detect a `!` breaking marker on the commit-subject prefix.
 *
 * Matches `type!:`, `type(scope)!:`, and `scope|type!:` formats at the start of the first line, after any leading
 * ticket prefix (e.g. `#42 `, `TOOL-123 `, `## `) is stripped via `COMMIT_PREPROCESSOR_PATTERNS`.
 * The `BREAKING CHANGE:` body footer is not considered. The marker alone does not make an item breaking: The commit's
 * work-type policy must also permit `!` (see `isBreakingUnderPolicy`).
 * The regex is anchored so descriptions containing `!:` later in the line (e.g. `"Fix edge case using field!: value
 * notation"`) are not misclassified as breaking.
 */
function subjectHasBreakingMarker(message: string): boolean {
  let subject = message.split('\n', 1)[0] ?? '';
  for (const pattern of COMMIT_PREPROCESSOR_PATTERNS) {
    subject = subject.replace(pattern, '');
  }
  return SUBJECT_BREAKING_MARKER_PATTERN.test(subject);
}

/** Extract the description from a commit message, stripping ticket ID and type prefix. */
function extractDescription(message: string): string {
  const firstLine = message.split('\n', 1)[0] ?? message;
  const afterColon = firstLine.split(': ').slice(1).join(': ');
  if (afterColon.length > 0) {
    return afterColon.charAt(0).toUpperCase() + afterColon.slice(1);
  }
  return firstLine;
}

/**
 * Regex patterns for trailer lines to strip from the tail of a commit body.
 *
 * No pattern matches `Migration:`. `extractMigration` reads the stripped body, so a pattern
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
 * Extract the body from a commit message, stripping trailing trailer metadata.
 *
 * Takes lines 2+ of the commit message, trims leading/trailing blank lines, then walks backward
 * from the end dropping consecutive lines that match trailer patterns or are blank lines adjacent
 * to the trailer block. Returns `undefined` when the resulting body is empty.
 */
function extractBody(message: string): string | undefined {
  const lines = message.split('\n').slice(1);

  // Walk forward from the first non-blank line.
  let start = 0;
  while (start < lines.length && (lines[start] ?? '').trim() === '') {
    start += 1;
  }

  // Walk backward, dropping blank lines and trailer-matching lines from the tail.
  let end = lines.length;
  while (end > start) {
    const line = lines[end - 1] ?? '';
    const trimmed = line.trim();
    if (trimmed === '') {
      end -= 1;
      continue;
    }
    if (TRAILER_PATTERNS.some((pattern) => pattern.test(trimmed))) {
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
