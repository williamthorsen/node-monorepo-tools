import { chainError } from '@williamthorsen/toolbelt.errors/candidate';

import { extractVersion } from './changelogJsonUtils.ts';
import { classifyChangelogCommit } from './classifyChangelogCommit.ts';
import { DEFAULT_BREAKING_POLICIES, DEFAULT_WORK_TYPES } from './defaults.ts';
import { extractMigration } from './extractMigration.ts';
import type { GenerateChangelogOptions } from './generateChangelogs.ts';
import { COMMIT_PREPROCESSOR_PATTERNS, parseCommitMessage, PIPE_SCOPE_SOURCE } from './parseCommitMessage.ts';
import { resolveCliffConfigPath } from './resolveCliffConfigPath.ts';
import { runGitCliff } from './runGitCliff.ts';
import { stripEmojiPrefix } from './stripEmojiPrefix.ts';
import { isRecord, isUnknownArray } from './typeGuards.ts';
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
 * Shape of a single commit in git-cliff's `--context` JSON output.
 *
 * The `group` that cliff's pass-through parser assigns is deliberately absent:
 * `classifyChangelogCommit` derives the section from the commit message instead.
 */
interface CliffContextCommit {
  message: string;
  /** Full commit SHA when present; git-cliff emits it as `id`. */
  id?: string;
}

/** Shape of a single release in git-cliff's `--context` JSON output. */
interface CliffContextRelease {
  version?: string;
  timestamp?: number;
  commits?: CliffContextCommit[];
}

/**
 * Build structured changelog entries from git history using git-cliff `--context`.
 *
 * Pure data: invokes git-cliff, parses its `--context` output, and returns the transformed
 * `ChangelogEntry[]`. Performs no `changelog.json` I/O — callers persist the entries via
 * `renderChangelogJson`.
 *
 * Always invokes git-cliff: dry-run is the caller's concern (it governs whether the file write happens,
 * not whether git-cliff runs). This means dry-run exercises the full git-cliff toolchain and surfaces missing-binary,
 * malformed-config, and template-resolution failures earlier than before.
 */
export function buildChangelogEntries(
  config: Pick<ReleaseConfig, 'breakingPolicies' | 'changelogJson' | 'cliffConfigPath' | 'workTypes'>,
  tag: string,
  options?: GenerateChangelogOptions,
): ChangelogEntry[] {
  const resolvedConfigPath = resolveCliffConfigPath(config.cliffConfigPath, import.meta.url);

  const cliffArgs = ['--context', '--tag', tag];

  if (options?.tagPattern !== undefined) {
    cliffArgs.push('--tag-pattern', options.tagPattern);
  }

  const includePaths = options?.includePaths ?? [];
  for (const includePath of includePaths) {
    cliffArgs.push('--include-path', includePath);
  }

  try {
    const contextJson = runGitCliff(resolvedConfigPath, cliffArgs);

    const releases = parseCliffContext(contextJson);
    const devOnlySections = new Set(config.changelogJson.devOnlySections);
    const workTypes = config.workTypes ?? DEFAULT_WORK_TYPES;
    const breakingPolicies = config.breakingPolicies ?? DEFAULT_BREAKING_POLICIES;
    return transformReleases(releases, devOnlySections, workTypes, breakingPolicies);
  } catch (error: unknown) {
    throw chainError(`Failed to build changelog entries for tag ${tag}`, error);
  }
}

/** Parse the JSON output from `git-cliff --context`. */
function parseCliffContext(json: string): CliffContextRelease[] {
  const parsed: unknown = JSON.parse(json);
  if (!isUnknownArray(parsed)) {
    throw new TypeError('Expected git-cliff --context output to be an array');
  }
  return parsed.map(toCliffContextRelease);
}

/** Narrow an unknown value to a `CliffContextRelease`, treating non-object entries as empty releases. */
function toCliffContextRelease(value: unknown): CliffContextRelease {
  if (!isRecord(value)) {
    return {};
  }
  const release: CliffContextRelease = {};
  if (typeof value['version'] === 'string') {
    release.version = value['version'];
  }
  if (typeof value['timestamp'] === 'number') {
    release.timestamp = value['timestamp'];
  }
  if (isUnknownArray(value['commits'])) {
    release.commits = value['commits'].map(toCliffContextCommit);
  }
  return release;
}

/** Narrow an unknown value to a `CliffContextCommit`. */
function toCliffContextCommit(value: unknown): CliffContextCommit {
  if (!isRecord(value)) {
    return { message: '' };
  }
  const commit: CliffContextCommit = {
    message: typeof value['message'] === 'string' ? value['message'] : '',
  };
  if (typeof value['id'] === 'string') {
    commit.id = value['id'];
  }
  return commit;
}

/**
 * Transform git-cliff context releases into `ChangelogEntry[]`.
 *
 * Cliff emits every commit in the range, so `classifyChangelogCommit` decides which of them reach a
 * changelog and under which section header. A commit it rejects contributes nothing, and a release
 * left with no section contributes no entry.
 */
function transformReleases(
  releases: CliffContextRelease[],
  devOnlySections: Set<string>,
  workTypes: NonNullable<ReleaseConfig['workTypes']>,
  breakingPolicies: NonNullable<ReleaseConfig['breakingPolicies']>,
): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  // Normalise dev-only entries once so consumer overrides written as bare names (e.g. `'Internal features'`)
  // match emoji-prefixed default titles (`🏗️ Internal features`) without requiring config updates.
  const devOnlyNormalised = new Set([...devOnlySections].map(stripGroupDecorations));

  for (const release of releases) {
    if (release.version === undefined) {
      continue;
    }

    const version = extractVersion(release.version);
    const date =
      release.timestamp !== undefined ? new Date(release.timestamp * 1_000).toISOString().slice(0, 10) : 'unreleased';

    const sectionMap = new Map<string, ChangelogItem[]>();

    const commits = release.commits ?? [];
    for (const commit of commits) {
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
      if (commit.id !== undefined && commit.id !== '') {
        item.hash = commit.id;
      }
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
  commit: CliffContextCommit,
  workTypes: NonNullable<ReleaseConfig['workTypes']>,
  breakingPolicies: NonNullable<ReleaseConfig['breakingPolicies']>,
): boolean {
  if (!subjectHasBreakingMarker(commit.message)) {
    return false;
  }
  const parsed = parseCommitMessage(commit.message, commit.id ?? '', workTypes, undefined, { breakingPolicies });
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
