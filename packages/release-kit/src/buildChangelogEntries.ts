import { chainError } from '@williamthorsen/toolbelt.errors/candidate';

import { extractVersion } from './changelogJsonUtils.ts';
import { classifyChangelogCommit } from './classifyChangelogCommit.ts';
import { DEFAULT_BREAKING_POLICIES, DEFAULT_WORK_TYPES } from './defaults.ts';
import { enumerateReleaseWindows, type RawCommit, type ReleaseWindow } from './enumerateReleaseWindows.ts';
import { extractMigration } from './extractMigration.ts';
import type { GenerateChangelogOptions } from './generateChangelogs.ts';
import { COMMIT_PREPROCESSOR_PATTERNS, parseCommitMessage, PIPE_SCOPE_SOURCE } from './parseCommitMessage.ts';
import { stripEmojiPrefix } from './stripEmojiPrefix.ts';
import type { ChangelogEntry, ChangelogItem, ChangelogSection, ReleaseConfig } from './types.ts';

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
 * uses, and returns the transformed `ChangelogEntry[]`. Performs no `changelog.json` I/O; callers
 * persist the entries via `renderChangelogJson`.
 *
 * `tag` names the unreleased window, which holds the commits that no matching tag contains.
 */
export function buildChangelogEntries(
  config: Pick<ReleaseConfig, 'breakingPolicies' | 'changelogJson' | 'workTypes'>,
  tag: string,
  options: GenerateChangelogOptions,
): ChangelogEntry[] {
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

/**
 * Transforms release windows into `ChangelogEntry[]`.
 *
 * A window holds every commit in its range, so `classifyChangelogCommit` decides which of them reach a
 * changelog and under which section header. A commit it rejects contributes nothing, and a release
 * left with no section contributes no entry.
 */
function transformReleases(
  releases: readonly ReleaseWindow[],
  devOnlySections: Set<string>,
  workTypes: NonNullable<ReleaseConfig['workTypes']>,
  breakingPolicies: NonNullable<ReleaseConfig['breakingPolicies']>,
): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  // Normalise dev-only entries once so consumer overrides written as bare names (e.g. `'Internal features'`)
  // match emoji-prefixed default titles (`🏗️ Internal features`) without requiring config updates.
  const devOnlyNormalised = new Set([...devOnlySections].map(stripGroupDecorations));

  for (const release of releases) {
    const version = extractVersion(release.version);
    const date = new Date(release.timestamp * 1_000).toISOString().slice(0, 10);

    const sectionMap = new Map<string, ChangelogItem[]>();

    for (const commit of release.commits) {
      const group = classifyChangelogCommit(commit.message, workTypes);
      if (group === undefined) {
        continue;
      }
      const description = extractDescription(commit.message);
      const body = extractBody(commit.message);
      const breaking = isBreakingUnderPolicy(commit, workTypes, breakingPolicies);

      let items = sectionMap.get(group);
      if (items === undefined) {
        items = [];
        sectionMap.set(group, items);
      }
      const item: ChangelogItem = { description };
      if (body !== undefined) {
        item.body = body;
      }
      if (breaking) {
        item.breaking = true;
      }
      // Derive from the trailer-stripped body rather than the raw message, so the field comes
      // from exactly the text that lands in `body`.
      const migration = extractMigration(body);
      if (migration !== undefined) {
        item.migration = migration;
      }
      item.hash = commit.hash;
      items.push(item);
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

  return entries;
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
