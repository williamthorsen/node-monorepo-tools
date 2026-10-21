import { chainError } from '@williamthorsen/toolbelt.errors/candidate';

import {
  buildEntryItem,
  buildTitleItem,
  type ChangelogDiagnostics,
  type DerivedItem,
  hasRoutedEntry,
  type ReadContext,
} from './buildChangelogItem.ts';
import { buildEmptyReleaseEntry } from './buildEmptyReleaseEntry.ts';
import { extractVersion } from './changelogJsonUtils.ts';
import { classifyChangelogCommit, isNonChangeSubject, isReleaseSubject } from './classifyChangelogCommit.ts';
import { DEFAULT_BREAKING_POLICIES, DEFAULT_VERSION_PATTERNS, DEFAULT_WORK_TYPES } from './defaults.ts';
import { type BumpSignal, determineBumpType } from './determineBumpType.ts';
import { enumerateReleaseWindows, type RawCommit, type ReleaseWindow } from './enumerateReleaseWindows.ts';
import type { GenerateChangelogOptions } from './generateChangelogs.ts';
import { parseChangeRecordBlock } from './parseChangeRecordBlock.ts';
import { stripEmojiPrefix } from './stripEmojiPrefix.ts';
import type { ChangelogEntry, ChangelogItem, ChangelogSection, ReleaseSettings, ReleaseType } from './types.ts';

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

/**
 * Reads a scope's release windows once and returns the changelog items of every window, with what the unreleased
 * window decides: its commits, its bump, and its diagnostics.
 *
 * A commit whose last `change-record` block records at least one entry routed to `options.scope` yields one item per
 * routed entry; any other commit, including one whose entries all route elsewhere, is classified by its title through
 * `classifyChangelogCommit`. A `release:` or merge subject yields nothing either way. The read records diagnostics only for the unreleased window, since the
 * released windows were reported when they were prepared.
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
      ...(options.scope !== undefined && {
        routing: { scope: options.scope, scopeAliases: config.scopeAliases ?? {} },
      }),
      versionPatterns: config.versionPatterns ?? DEFAULT_VERSION_PATTERNS,
      workTypes: config.workTypes ?? DEFAULT_WORK_TYPES,
    };
    return transformReleases(windows, context);
  } catch (error: unknown) {
    throw chainError(`Failed to read the release history for ${options.tagPrefixes.join(', ')}`, error);
  }
}

/** One read of a scope's release windows. */
export interface ReleaseHistory {
  /** The newest matching tag that HEAD reaches; undefined when none does. */
  previousTag: string | undefined;
  /** Entries of the released windows, newest first; a window that doesn't yield any item contributes none. */
  releasedEntries: ChangelogEntry[];
  unreleased: UnreleasedWindowReading;
}

/** The configuration that `readReleaseHistory` reads. */
export type ReleaseHistoryConfig = Pick<
  ReleaseSettings,
  'breakingPolicies' | 'changelogJson' | 'scopeAliases' | 'versionPatterns' | 'workTypes'
>;

/**
 * Strips a section title down to its bare name.
 *
 * A default title has a leading emoji (e.g. `"🐛 Bug fixes"`), while a consumer's
 * `devOnlySections` or `workTypes` override may be written as a bare name. Comparing both sides
 * through this helper lets the two forms match.
 */
export function stripGroupDecorations(group: string): string {
  return stripEmojiPrefix(group);
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
 * unreleased window doesn't yield any item, the synthetic "Forced version bump." entry dated `today` ahead of the
 * released entries.
 */
export function toReleaseEntries(history: ReleaseHistory, tag: string, today: string): ChangelogEntry[] {
  if (history.unreleased.sections.length === 0) {
    return [buildEmptyReleaseEntry(extractVersion(tag), today), ...history.releasedEntries];
  }
  return toChangelogEntries(history, tag);
}

/** The unreleased window: its changelog sections and commits, and the bump and diagnostics that they determine. */
export interface UnreleasedWindowReading {
  /** The highest bump that the window's items call for; undefined when the window doesn't yield any item. */
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
   * Commits that don't yield any item and that neither an exclusion nor a diagnostic accounts for, newest first;
   * undefined when none.
   */
  unparseableCommits: RawCommit[] | undefined;
}

// region | Helpers

/** Adds an item to the section that `header` names, creating the section on first use. */
function appendItem(sectionMap: Map<string, ChangelogItem[]>, header: string, item: ChangelogItem): void {
  let items = sectionMap.get(header);
  if (items === undefined) {
    items = [];
    sectionMap.set(header, items);
  }
  items.push(item);
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

/** Returns the canonical priority of a section title; an unknown title sorts last. */
function canonicalSectionPriority(title: string): number {
  const index = CANONICAL_SECTION_ORDER.get(stripGroupDecorations(title));
  return index ?? Infinity;
}

/** Formats Unix seconds as an ISO calendar date. */
function formatDate(timestamp: number): string {
  return new Date(timestamp * 1_000).toISOString().slice(0, 10);
}

/**
 * Reads the items that one commit yields: those of its routed change-record entries when it has any, and otherwise
 * the item that its title yields.
 *
 * `isUnparseable` is true for a commit that doesn't yield any item, because its title lacks a ticket prefix or a
 * resolvable type, and that isn't already reported by any malformed-block diagnostic. `diagnostics` is undefined for a
 * released window, which reports nothing.
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
  // A block whose entries all route elsewhere leaves the commit to its title, because the commit still changed files
  // in this workspace's window.
  if (reading.kind === 'read' && reading.entries.length > 0 && hasRoutedEntry(reading.entries, context.routing)) {
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

// endregion | Helpers
