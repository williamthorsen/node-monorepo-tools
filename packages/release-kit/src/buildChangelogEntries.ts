import { chainError } from '@williamthorsen/toolbelt.errors/candidate';

import { buildEmptyReleaseEntry } from './buildEmptyReleaseEntry.ts';
import { extractVersion } from './changelogJsonUtils.ts';
import { classifyChangelogCommit, isNonChangeSubject, isReleaseSubject } from './classifyChangelogCommit.ts';
import { DEFAULT_BREAKING_POLICIES, DEFAULT_VERSION_PATTERNS, DEFAULT_WORK_TYPES } from './defaults.ts';
import { type BumpSignal, determineBumpType } from './determineBumpType.ts';
import { enumerateReleaseWindows, type RawCommit, type ReleaseWindow } from './enumerateReleaseWindows.ts';
import { extractMigration } from './extractMigration.ts';
import type { GenerateChangelogOptions } from './generateChangelogs.ts';
import { type ChangeRecordEntry, parseChangeRecordBlock, stripChangeRecordBlocks } from './parseChangeRecordBlock.ts';
import { evaluateBreakingPolicy, parseSubject, resolveType } from './parseCommitMessage.ts';
import { stripEmojiPrefix } from './stripEmojiPrefix.ts';
import type {
  ChangelogEntry,
  ChangelogItem,
  ChangelogSection,
  MalformedChangeRecordBlock,
  PolicyViolation,
  ReleaseConfig,
  ReleaseType,
  UndeclaredEntryType,
  UnroutedEntryScope,
  VersionPatterns,
  WorkTypeConfig,
} from './types.ts';

/** Placeholder version for the unreleased window, whose tag is unknown until its bump is decided. */
const UNRELEASED_TAG = 'unreleased';

/**
 * The priority of each bare section name, in `DEFAULT_WORK_TYPES` order. `changelog.json` lists sections in this order
 * whatever the order of the commits, because tools that read the file directly depend on it.
 *
 * The key is the bare name, to match both the emoji-prefixed default headers (e.g. `🐛 Bug fixes`) and the bare names
 * that a `workTypes` override may supply.
 */
const CANONICAL_SECTION_ORDER: ReadonlyMap<string, number> = new Map(
  Object.values(DEFAULT_WORK_TYPES).map((config, index) => [stripGroupDecorations(config.header), index]),
);

/** Returns the canonical priority of a section title; an unknown title sorts last. */
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
 * Builds structured changelog entries from the release windows of git history, naming the unreleased window `tag`.
 *
 * Composes `readReleaseHistory` and `toChangelogEntries` for a caller that knows the tag before it reads.
 */
export function buildChangelogEntries(
  config: ReleaseHistoryConfig,
  tag: string,
  options: GenerateChangelogOptions,
): { entries: ChangelogEntry[]; diagnostics: ChangelogDiagnostics } {
  const history = readReleaseHistory(config, options);
  return { entries: toChangelogEntries(history, tag), diagnostics: history.unreleased.diagnostics };
}

/** What reading the unreleased window reports beyond its items. */
export interface ChangelogDiagnostics {
  malformedBlocks: MalformedChangeRecordBlock[];
  /** Breaking-policy violations of the window's titles and change-record entries. */
  policyViolations: PolicyViolation[];
  undeclaredEntryTypes: UndeclaredEntryType[];
  /** Entry scopes that route to no workspace. A read leaves it empty: only a pass over every workspace can fill it. */
  unroutedEntryScopes: UnroutedEntryScope[];
}

/**
 * Reads a scope's release windows once and returns the changelog items of every window, with what the unreleased
 * window decides: its commits, its bump, and its diagnostics.
 *
 * A commit whose last `change-record` block records entries yields one item per entry routed to
 * `options.workspaceDir`; any other commit is classified by its title through `classifyChangelogCommit`. A `release:`
 * or merge subject yields nothing either way. Only the unreleased window records diagnostics, since the released
 * windows were reported when they were prepared.
 */
export function readReleaseHistory(config: ReleaseHistoryConfig, options: GenerateChangelogOptions): ReleaseHistory {
  try {
    const windows = enumerateReleaseWindows({
      ...(options.paths !== undefined && { paths: options.paths }),
      tagPrefixes: options.tagPrefixes,
      unreleasedTag: UNRELEASED_TAG,
    });
    const context: ReadContext = {
      breakingPolicies: config.breakingPolicies ?? DEFAULT_BREAKING_POLICIES,
      devOnlySections: new Set(config.changelogJson.devOnlySections.map(stripGroupDecorations)),
      ...(options.workspaceDir !== undefined && {
        routing: { workspaceDir: options.workspaceDir, scopeAliases: config.scopeAliases ?? {} },
      }),
      versionPatterns: config.versionPatterns ?? DEFAULT_VERSION_PATTERNS,
      workTypes: config.workTypes ?? DEFAULT_WORK_TYPES,
    };
    return transformReleases(windows, context);
  } catch (error: unknown) {
    throw chainError(`Failed to read the release history for ${options.tagPrefixes.join(', ')}`, error);
  }
}

/** The configuration that `readReleaseHistory` reads. */
export type ReleaseHistoryConfig = Pick<
  ReleaseConfig,
  'breakingPolicies' | 'changelogJson' | 'scopeAliases' | 'versionPatterns' | 'workTypes'
>;

/** One read of a scope's release windows. */
export interface ReleaseHistory {
  /** The newest matching tag that HEAD reaches; undefined when none does. */
  previousTag: string | undefined;
  /** Entries of the released windows, newest first; a window that yields no item contributes none. */
  releasedEntries: ChangelogEntry[];
  unreleased: UnreleasedWindowReading;
}

/** The unreleased window: its changelog sections and commits, and the bump and diagnostics that they determine. */
export interface UnreleasedWindowReading {
  /** The highest bump that the window's items call for; undefined when the window yields no item. */
  bump: ReleaseType | undefined;
  /** The window's commits, newest first, without release commits. */
  commits: RawCommit[];
  /** The date of the window's entry, from the time of the read. */
  date: string;
  diagnostics: ChangelogDiagnostics;
  /** The number of commits that yield at least one item. */
  parsedCommitCount: number;
  sections: ChangelogSection[];
  /**
   * Commits that yield no item and that neither an exclusion nor a diagnostic accounts for, newest first; undefined
   * when none.
   */
  unparseableCommits: RawCommit[] | undefined;
}

/** Labels the unreleased window of `history` with `tag` and returns the entries of every window, newest first. */
export function toChangelogEntries(history: ReleaseHistory, tag: string): ChangelogEntry[] {
  const { unreleased } = history;
  if (unreleased.sections.length === 0) {
    return [...history.releasedEntries];
  }
  return [
    { version: extractVersion(tag), date: unreleased.date, sections: unreleased.sections },
    ...history.releasedEntries,
  ];
}

/**
 * Returns the entries that a direct release tagged `tag` records: those of `toChangelogEntries`, or, when the
 * unreleased window yields no item, the synthetic "Forced version bump." entry dated `today` ahead of the released
 * entries.
 */
export function toReleaseEntries(history: ReleaseHistory, tag: string, today: string): ChangelogEntry[] {
  if (history.unreleased.sections.length === 0) {
    return [buildEmptyReleaseEntry(extractVersion(tag), today), ...history.releasedEntries];
  }
  return toChangelogEntries(history, tag);
}

/** What every window's read shares. */
interface ReadContext {
  breakingPolicies: NonNullable<ReleaseConfig['breakingPolicies']>;
  /** Dev-only section titles, stripped of decorations. */
  devOnlySections: ReadonlySet<string>;
  /** The workspace to which entries are routed; undefined for a read that takes every entry. */
  routing?: EntryRouting;
  versionPatterns: VersionPatterns;
  workTypes: NonNullable<ReleaseConfig['workTypes']>;
}

/** The workspace that a read routes change-record entries to, and the aliases that resolve their scopes. */
interface EntryRouting {
  scopeAliases: Readonly<Record<string, string>>;
  workspaceDir: string;
}

/** An item with the section header under which it is filed and the signal that it contributes to the bump. */
interface DerivedItem {
  header: string;
  item: ChangelogItem;
  signal: BumpSignal;
}

/** Transforms the windows that `enumerateReleaseWindows` returns, the unreleased one first, into a history. */
function transformReleases(windows: readonly ReleaseWindow[], context: ReadContext): ReleaseHistory {
  const [unreleasedWindow, baselineWindow] = windows;
  const diagnostics: ChangelogDiagnostics = {
    malformedBlocks: [],
    policyViolations: [],
    undeclaredEntryTypes: [],
    unroutedEntryScopes: [],
  };
  const signals: BumpSignal[] = [];
  const unparseable: RawCommit[] = [];
  let parsedCommitCount = 0;

  const sectionMap = new Map<string, ChangelogItem[]>();
  const unreleasedCommits = unreleasedWindow?.commits ?? [];
  for (const commit of unreleasedCommits) {
    const reading = readCommit(commit, context, diagnostics);
    for (const derived of reading.items) {
      appendItem(sectionMap, derived.header, derived.item);
      signals.push(derived.signal);
    }
    if (reading.items.length > 0) {
      parsedCommitCount += 1;
    } else if (reading.isUnparseable) {
      unparseable.push(commit);
    }
  }

  const releasedEntries: ChangelogEntry[] = [];
  for (const release of windows.slice(1)) {
    const releaseSections = new Map<string, ChangelogItem[]>();
    for (const commit of release.commits) {
      for (const derived of readCommit(commit, context, undefined).items) {
        appendItem(releaseSections, derived.header, derived.item);
      }
    }
    const sections = buildSections(releaseSections, context.devOnlySections);
    if (sections.length > 0) {
      releasedEntries.push({ version: extractVersion(release.version), date: formatDate(release.timestamp), sections });
    }
  }

  return {
    previousTag: baselineWindow?.version,
    releasedEntries,
    unreleased: {
      bump: determineBumpType(signals, context.workTypes, context.versionPatterns),
      commits: unreleasedCommits.filter((commit) => !isReleaseSubject(commit.subject)).toReversed(),
      date: formatDate(unreleasedWindow?.timestamp ?? Math.floor(Date.now() / 1_000)),
      diagnostics,
      parsedCommitCount,
      sections: buildSections(sectionMap, context.devOnlySections),
      unparseableCommits: unparseable.length > 0 ? unparseable.toReversed() : undefined,
    },
  };
}

/**
 * Reads the items that one commit yields.
 *
 * `isUnparseable` is true for a commit that yields no item because its title has no ticket prefix or no resolvable
 * type, and that no malformed-block diagnostic already reports. `diagnostics` is undefined for a released window,
 * which reports nothing.
 */
function readCommit(
  commit: RawCommit,
  context: ReadContext,
  diagnostics: ChangelogDiagnostics | undefined,
): { items: DerivedItem[]; isUnparseable: boolean } {
  if (isNonChangeSubject(commit.subject)) {
    return { items: [], isUnparseable: false };
  }

  const reading = parseChangeRecordBlock(commit.message);
  if (reading.kind === 'malformed') {
    diagnostics?.malformedBlocks.push({
      commitHash: commit.hash,
      commitSubject: commit.subject,
      reason: reading.reason,
    });
  }
  if (reading.kind === 'read' && reading.entries.length > 0) {
    const items = reading.entries.flatMap(
      (entry, entryIndex) =>
        buildEntryItem(commit, entry, entryIndex + 1, reading.prNumber, context, diagnostics) ?? [],
    );
    return { items, isUnparseable: false };
  }

  const classification = classifyChangelogCommit(commit, context.workTypes, {
    breakingPolicies: context.breakingPolicies,
    ...(diagnostics !== undefined && {
      onPolicyViolation: (violating, type, surface) => {
        diagnostics.policyViolations.push({
          commitHash: violating.hash,
          commitSubject: violating.subject,
          type,
          surface,
        });
      },
    }),
  });
  if (classification.kind !== 'header') {
    return { items: [], isUnparseable: classification.kind === 'unparseable' && reading.kind !== 'malformed' };
  }
  const item = buildTitleItem(commit, classification.breaking, context.workTypes);
  return {
    items: [
      { header: classification.header, item, signal: { type: classification.type, breaking: item.breaking === true } },
    ],
    isUnparseable: false,
  };
}

/** Turns grouped items into sections in canonical order, marking each dev-only section. */
function buildSections(
  sectionMap: ReadonlyMap<string, ChangelogItem[]>,
  devOnlySections: ReadonlySet<string>,
): ChangelogSection[] {
  const sections: ChangelogSection[] = [];
  for (const [title, items] of sectionMap) {
    sections.push({
      title,
      audience: devOnlySections.has(stripGroupDecorations(title)) ? 'dev' : 'all',
      items,
    });
  }
  // A stable sort keeps unknown sections, whose priority is `Infinity`, in encounter order.
  return sections.toSorted((a, b) => canonicalSectionPriority(a.title) - canonicalSectionPriority(b.title));
}

/**
 * Reports whether an entry with `scopes` reaches the routed workspace: Its scopes are empty, contain `*`, or name the
 * workspace's `dir` once `scopeAliases` resolves them.
 */
function isRoutedTo(scopes: readonly string[], routing: EntryRouting): boolean {
  if (scopes.length === 0) {
    return true;
  }
  return scopes.some((scope) => {
    const resolved = routing.scopeAliases[scope] ?? scope;
    return resolved === '*' || resolved === routing.workspaceDir;
  });
}

/** Formats Unix seconds as an ISO calendar date. */
function formatDate(timestamp: number): string {
  return new Date(timestamp * 1_000).toISOString().slice(0, 10);
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
 * Returns `undefined` for an entry whose scopes route it away from the workspace being read, for one whose type is
 * undeclared, which is recorded as a diagnostic, and for one whose type is excluded from the changelog. An entry
 * whose `breaking` violates its type's policy is recorded as a policy violation and yields an item that is not
 * breaking.
 */
function buildEntryItem(
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
  return { header: config.header, item, signal: { type, breaking } };
}

/**
 * Builds the item that a commit without a usable change-record block yields from its title and body. The body leaves
 * out any block, which records data rather than prose.
 *
 * `isParsedBreaking` is the parser's policy-evaluated flag. The item is breaking only when the subject also carries a
 * prefix `!`, because the parse also counts a `BREAKING CHANGE:` footer on an `optional`-policy type, which the
 * changelog ignores.
 */
function buildTitleItem(
  commit: RawCommit,
  isParsedBreaking: boolean,
  workTypes: Record<string, WorkTypeConfig>,
): ChangelogItem {
  const body = extractBody(stripChangeRecordBlocks(commit.message));
  const item: ChangelogItem = { description: extractDescription(commit.message) };
  if (body !== undefined) {
    item.body = body;
  }
  if (isParsedBreaking && subjectHasBreakingMarker(commit.message, workTypes)) {
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

/**
 * Reports whether the commit subject carries the `!` breaking marker, as change-grammar reads it. The `BREAKING
 * CHANGE:` body footer is not considered, and the marker alone does not make an item breaking: The commit's work-type
 * policy must also permit `!` (see `buildTitleItem`).
 */
function subjectHasBreakingMarker(message: string, workTypes: Record<string, WorkTypeConfig>): boolean {
  return parseSubject(message.split('\n', 1)[0] ?? '', workTypes)?.breaking === true;
}

/** Extracts the description from a commit subject: the text after its first `: `, capitalized. */
function extractDescription(message: string): string {
  const firstLine = message.split('\n', 1)[0] ?? message;
  const afterColon = firstLine.split(': ').slice(1).join(': ');
  return afterColon.charAt(0).toUpperCase() + afterColon.slice(1);
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
