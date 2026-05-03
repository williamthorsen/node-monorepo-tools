import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractVersion } from './changelogJsonUtils.ts';
import { DEFAULT_WORK_TYPES } from './defaults.ts';
import type { GenerateChangelogOptions } from './generateChangelogs.ts';
import { COMMIT_PREPROCESSOR_PATTERNS } from './parseCommitMessage.ts';
import { resolveCliffConfigPath } from './resolveCliffConfigPath.ts';
import { stripEmojiPrefix } from './stripEmojiPrefix.ts';
import { isRecord, isUnknownArray } from './typeGuards.ts';
import type { ChangelogEntry, ChangelogItem, ChangelogSection, ReleaseConfig } from './types.ts';

/** Match a leading `<!-- ... -->` HTML comment, used to strip the canonical-order prefix from cliff group strings. */
const HTML_COMMENT_PREFIX_PATTERN = /^<!--[^>]*-->/;

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
 * (e.g. `🐛 Bug fixes`); the bare key is used so the index matches both decorated and
 * bare titles produced by `transformReleases` (which strips `<!-- NN -->` and may strip
 * the emoji depending on the consumer's config).
 */
const CANONICAL_SECTION_ORDER: ReadonlyMap<string, number> = new Map(
  Object.values(DEFAULT_WORK_TYPES).map((config, index) => [stripGroupDecorations(config.header), index]),
);

/** Lookup the canonical priority of a section title. Unknown sections sort to the end. */
function canonicalSectionPriority(title: string): number {
  const index = CANONICAL_SECTION_ORDER.get(stripGroupDecorations(title));
  return index ?? Number.POSITIVE_INFINITY;
}

/**
 * Strip cliff-template decorations from a group string, returning the bare section name.
 *
 * The bundled `cliff.toml.template` encodes canonical row order as a hidden HTML comment
 * (e.g. `"<!-- 04 -->🐛 Bug fixes"`) so tera's `group_by` filter sorts groups predictably.
 * The body template's `striptags` filter erases the comment from the rendered heading,
 * but downstream consumers that read the raw `group` value (changelog.json titles, the
 * dev-vs-public classifier, the drift test) see the prefix and must strip it. The trailing
 * `stripEmojiPrefix` keeps the helper backward-compatible with consumer overrides written
 * as bare names.
 */
export function stripGroupDecorations(group: string): string {
  return stripEmojiPrefix(group.replace(HTML_COMMENT_PREFIX_PATTERN, ''));
}

/** Shape of a single commit in git-cliff's `--context` JSON output. */
interface CliffContextCommit {
  message: string;
  group?: string;
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
 * `writeChangelogJson` or `upsertChangelogJson`.
 *
 * Always invokes git-cliff: dry-run is the caller's concern (it governs whether the file
 * write happens, not whether git-cliff runs). This means dry-run exercises the full
 * git-cliff toolchain and surfaces missing-binary, malformed-config, and template-resolution
 * failures earlier than before.
 */
export function buildChangelogEntries(
  config: Pick<ReleaseConfig, 'cliffConfigPath' | 'changelogJson'>,
  tag: string,
  options?: GenerateChangelogOptions,
): ChangelogEntry[] {
  const resolvedConfigPath = resolveCliffConfigPath(config.cliffConfigPath, import.meta.url);

  let cliffConfigPath = resolvedConfigPath;
  let tempDir: string | undefined;
  if (resolvedConfigPath.endsWith('.template')) {
    tempDir = mkdtempSync(join(tmpdir(), 'cliff-'));
    cliffConfigPath = join(tempDir, 'cliff.toml');
    copyFileSync(resolvedConfigPath, cliffConfigPath);
  }

  const args = ['--config', cliffConfigPath, '--context', '--tag', tag];

  if (options?.tagPattern !== undefined) {
    args.push('--tag-pattern', options.tagPattern);
  }

  for (const includePath of options?.includePaths ?? []) {
    args.push('--include-path', includePath);
  }

  try {
    const contextJson = execFileSync('npx', ['--yes', 'git-cliff', ...args], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    const releases = parseCliffContext(contextJson);
    const devOnlySections = new Set(config.changelogJson.devOnlySections);
    return transformReleases(releases, devOnlySections);
  } catch (error: unknown) {
    throw new Error(
      `Failed to build changelog entries for tag ${tag}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (tempDir !== undefined) {
      rmSync(tempDir, { recursive: true, force: true });
    }
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
  if (typeof value.version === 'string') {
    release.version = value.version;
  }
  if (typeof value.timestamp === 'number') {
    release.timestamp = value.timestamp;
  }
  if (isUnknownArray(value.commits)) {
    release.commits = value.commits.map(toCliffContextCommit);
  }
  return release;
}

/** Narrow an unknown value to a `CliffContextCommit`. */
function toCliffContextCommit(value: unknown): CliffContextCommit {
  if (!isRecord(value)) {
    return { message: '' };
  }
  const commit: CliffContextCommit = {
    message: typeof value.message === 'string' ? value.message : '',
  };
  if (typeof value.group === 'string') {
    commit.group = value.group;
  }
  return commit;
}

/** Transform git-cliff context releases into `ChangelogEntry[]`. */
function transformReleases(releases: CliffContextRelease[], devOnlySections: Set<string>): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  // Normalise dev-only entries once so consumer overrides written as bare names (e.g. `'Internal'`)
  // match decorated default titles (`<!-- NN -->🏗️ Internal features`) without requiring config updates.
  const devOnlyNormalised = new Set([...devOnlySections].map(stripGroupDecorations));

  for (const release of releases) {
    if (release.version === undefined) {
      continue;
    }

    const version = extractVersion(release.version);
    const date =
      release.timestamp !== undefined ? new Date(release.timestamp * 1000).toISOString().slice(0, 10) : 'unreleased';

    const sectionMap = new Map<string, ChangelogItem[]>();

    for (const commit of release.commits ?? []) {
      // Strip the canonical-order HTML comment prefix from the group key so changelog.json
      // titles surface bare (the prefix exists only to drive cliff's group_by sort order).
      const group = stripCommentPrefix(commit.group ?? 'Other');
      const description = extractDescription(commit.message);
      const body = extractBody(commit.message);
      const breaking = subjectHasBreakingMarker(commit.message);

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

/** Remove only the leading `<!-- ... -->` HTML comment, preserving any emoji. */
function stripCommentPrefix(group: string): string {
  return group.replace(HTML_COMMENT_PREFIX_PATTERN, '');
}

/**
 * Detect a `!` breaking marker on the commit-subject prefix.
 *
 * Matches `type!:`, `type(scope)!:`, and `scope|type!:` formats at the start of the first
 * line, after any leading ticket prefix (e.g. `#42 `, `TOOL-123 `, `## `) is stripped via
 * `COMMIT_PREPROCESSOR_PATTERNS`. The `BREAKING CHANGE:` body footer is intentionally NOT
 * considered — only the prefix `!` marks a changelog item as breaking, keeping the changelog
 * signal aligned with the commit-prefix policy. The regex is anchored so descriptions
 * containing `!:` later in the line (e.g. `"Fix edge case using field!: value notation"`)
 * are not misclassified as breaking.
 */
function subjectHasBreakingMarker(message: string): boolean {
  let subject = message.split('\n', 1)[0] ?? '';
  for (const pattern of COMMIT_PREPROCESSOR_PATTERNS) {
    subject = subject.replace(pattern, '');
  }
  // Match a type-token followed by an optional scope (parenthesized or pipe-prefixed) and a literal `!:`.
  // Pipe-scope character class is `[^|]+` to mirror `parseCommitMessage`'s acceptance — keeping the
  // two regexes aligned prevents a class of bug where a future scope outside `[\w-]` would parse
  // as breaking via the prefix `!` but lose the changelog marker silently here.
  return /^(?:[^|]+\|)?\w+(?:\([^)]+\))?!:/.test(subject);
}

/** Extract the description from a commit message, stripping ticket ID and type prefix. */
function extractDescription(message: string): string {
  const firstLine = message.split('\n')[0] ?? message;
  const afterColon = firstLine.split(': ').slice(1).join(': ');
  if (afterColon.length > 0) {
    return afterColon.charAt(0).toUpperCase() + afterColon.slice(1);
  }
  return firstLine;
}

/** Regex patterns for trailer lines to strip from the tail of a commit body. */
const TRAILER_PATTERNS: RegExp[] = [
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
