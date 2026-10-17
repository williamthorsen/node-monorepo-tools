import { extractMigration } from './extractMigration.ts';
import { parseOverrideKey } from './loadChangelogOverrides.ts';
import type { ChangelogEntry, ChangelogItem, ChangelogOverride, ChangelogSection } from './types.ts';

/**
 * Applies overrides to changelog entries, returning new entries without mutating the input.
 *
 * Each key's hash prefix is matched against the distinct `ChangelogItem.hash` values:
 * - No match: The key is unmatched in this batch, and this function doesn't emit a warning.
 * - One match: A bare key resolves to every item of that commit, and an ordinal key `<hash>:<n>` to the items whose
 *   `entry` is `n`. A key that doesn't resolve to any item is unmatched, so an ordinal key on a title-derived item
 *   goes stale.
 * - Several matches: an error (ambiguous prefix).
 *
 * Two more conditions are errors, and the keys involved apply nowhere: a bare key that sets `description` or `body` on a
 * commit with several items, and two keys that resolve to the same item.
 *
 * `matchedKeys` lists the keys that resolved to at least one item without error. The caller computes stale-key
 * warnings, because in a monorepo a key may target a commit in another workspace: A key unmatched in one batch is not
 * necessarily stale.
 *
 * An override whose audience is `'skip'` removes its item, and a section left empty is dropped; an entry left without
 * sections is kept. An item without a `hash`, such as a synthetic propagation item, passes through unmatched. Errors
 * are returned rather than thrown, and the caller decides whether to abort.
 */
export function applyChangelogOverrides(
  entries: ChangelogEntry[],
  overrides: Map<string, ChangelogOverride>,
): { entries: ChangelogEntry[]; warnings: string[]; errors: string[]; matchedKeys: string[] } {
  const warnings: string[] = [];

  if (overrides.size === 0) {
    return { entries: entries.map(cloneEntry), warnings, errors: [], matchedKeys: [] };
  }

  const { errors, itemIdToKey } = resolveOverrideKeys(indexEntryPositions(entries), overrides);

  const itemIdToOverride = new Map<string, ChangelogOverride>();
  for (const [itemId, overrideKey] of itemIdToKey) {
    const override = overrides.get(overrideKey);
    if (override !== undefined) {
      itemIdToOverride.set(itemId, override);
    }
  }
  const matchedKeys = [...new Set(itemIdToKey.values())];

  const transformedEntries: ChangelogEntry[] = [];
  for (const entry of entries) {
    const transformedSections: ChangelogSection[] = [];
    for (const section of entry.sections) {
      const transformedItems = applyOverridesToItems(section.items, itemIdToOverride);
      if (transformedItems.length === 0) {
        continue;
      }
      transformedSections.push({ ...section, items: transformedItems });
    }
    transformedEntries.push({ ...entry, sections: transformedSections });
  }

  return { entries: transformedEntries, warnings, errors, matchedKeys };
}

/** Formats the warning for an override key that did not match any item in the changelog. */
export function formatStaleOverrideKeyWarning(key: string): string {
  return `Override key '${key}' did not match any item in the changelog (likely a stale reference)`;
}

/** Collects, for each hash, the distinct `entry` positions of the items that have it. */
export function indexItemPositions(
  items: readonly { hash?: string | undefined; entry?: number | undefined }[],
): Map<string, Set<number | undefined>> {
  const positionsByHash = new Map<string, Set<number | undefined>>();
  for (const item of items) {
    if (item.hash === undefined) continue;
    const positions = positionsByHash.get(item.hash) ?? new Set<number | undefined>();
    positions.add(item.entry);
    positionsByHash.set(item.hash, positions);
  }
  return positionsByHash;
}

/**
 * Resolves one override key against the commits' entry positions. `positions` lists the targeted items' `entry` values,
 * ascending, with `undefined` standing for a title-derived item; it is empty when the key doesn't target any item of
 * the commit.
 */
export function resolveOverrideKey(
  overrideKey: string,
  positionsByHash: Map<string, Set<number | undefined>>,
):
  | { kind: 'none' }
  | { kind: 'ambiguous'; hashes: string[] }
  | { kind: 'items'; hash: string; positions: (number | undefined)[] } {
  const { hashPrefix, entry } = parseOverrideKey(overrideKey);
  const hashes = positionsByHash
    .keys()
    .filter((hash) => hash.startsWith(hashPrefix))
    .toArray();
  const [hash] = hashes;
  if (hash === undefined) {
    return { kind: 'none' };
  }
  if (hashes.length > 1) {
    return { kind: 'ambiguous', hashes };
  }

  const available = [...(positionsByHash.get(hash) ?? [])];
  const positions =
    entry === undefined
      ? available.toSorted((left, right) => (left ?? 0) - (right ?? 0))
      : available.filter((position) => position === entry);
  return positions.length === 0 ? { kind: 'none' } : { kind: 'items', hash, positions };
}

// region | Helpers

/** Applies per-item overrides, dropping items whose `audience` resolves to `'skip'`. */
function applyOverridesToItems(
  items: ChangelogItem[],
  itemIdToOverride: Map<string, ChangelogOverride>,
): ChangelogItem[] {
  const result: ChangelogItem[] = [];
  for (const item of items) {
    if (item.hash === undefined) {
      result.push(cloneItem(item));
      continue;
    }
    const override = itemIdToOverride.get(formatItemId(item.hash, item.entry));
    if (override === undefined) {
      result.push(cloneItem(item));
      continue;
    }
    if (override.audience === 'skip') {
      continue;
    }
    result.push(applyOverrideToItem(item, override));
  }
  return result;
}

/**
 * Applies one override's field replacements to a `ChangelogItem`.
 *
 * A title-derived item re-derives `migration` from a replacement body so that the two cannot disagree; an item derived
 * from a change-record entry keeps the entry's `migration`, which does not appear in any body. An override file
 * cannot set `migration`. The item keeps its `hash`, so that a later application still matches it.
 */
function applyOverrideToItem(item: ChangelogItem, override: ChangelogOverride): ChangelogItem {
  const result: ChangelogItem = { ...item };
  if (override.description !== undefined) {
    result.description = override.description;
  }
  if (override.body !== undefined) {
    result.body = override.body;
  }
  if (override.body !== undefined && item.entry === undefined) {
    const migration = extractMigration(override.body);
    if (migration === undefined) {
      // The spread copied a migration extracted from the superseded body.
      delete result.migration;
    } else {
      result.migration = migration;
    }
  }
  if (override.breaking !== undefined) {
    result.breaking = override.breaking;
  }
  return result;
}

/** Shallow-clones a `ChangelogEntry` down to its items, so that the result doesn't share any object with the input. */
function cloneEntry(entry: ChangelogEntry): ChangelogEntry {
  return {
    ...entry,
    sections: entry.sections.map((section) => ({ ...section, items: section.items.map(cloneItem) })),
  };
}

/** Shallow-clones a `ChangelogItem`, so that the result doesn't share any item object with the input. */
function cloneItem(item: ChangelogItem): ChangelogItem {
  return { ...item };
}

/** Formats the ID of an item from its commit hash and entry position. */
function formatItemId(hash: string, entry: number | undefined): string {
  return entry === undefined ? hash : `${hash}:${entry}`;
}

/** Collects, for each commit hash in the entry tree, the distinct `entry` positions of its items. */
function indexEntryPositions(entries: readonly ChangelogEntry[]): Map<string, Set<number | undefined>> {
  return indexItemPositions(entries.flatMap((entry) => entry.sections.flatMap((section) => section.items)));
}

/**
 * Resolves every override key to the items that it targets, and reports ambiguous prefixes, field overrides on a bare
 * key that spans several items, and keys that overlap on an item. Returns the item-to-key map with every erroring key
 * removed.
 */
function resolveOverrideKeys(
  positionsByHash: Map<string, Set<number | undefined>>,
  overrides: Map<string, ChangelogOverride>,
): { errors: string[]; itemIdToKey: Map<string, string> } {
  const errors: string[] = [];
  const failedKeys = new Set<string>();
  const itemIdToKey = new Map<string, string>();

  for (const [overrideKey, override] of overrides) {
    const resolution = resolveOverrideKey(overrideKey, positionsByHash);
    if (resolution.kind === 'ambiguous') {
      errors.push(
        `Override key '${overrideKey}' is ambiguous: matches multiple commits (${resolution.hashes.join(', ')}). ` +
          'Use a longer prefix or the full commit hash.',
      );
      continue;
    }
    if (resolution.kind === 'none') {
      continue;
    }

    const { hash, positions } = resolution;
    if (parseOverrideKey(overrideKey).entry === undefined && positions.length > 1) {
      const fieldsSet = (['description', 'body'] as const).filter((field) => override[field] !== undefined);
      if (fieldsSet.length > 0) {
        const ordinalKeys = positions.map((position) => `${overrideKey}:${position}`).join(', ');
        errors.push(
          `Override key '${overrideKey}' sets ${fieldsSet.join(' and ')} on a commit with several items; use ${ordinalKeys}`,
        );
        continue;
      }
    }

    for (const position of positions) {
      const itemId = formatItemId(hash, position);
      const claimingKey = itemIdToKey.get(itemId);
      if (claimingKey === undefined) {
        itemIdToKey.set(itemId, overrideKey);
        continue;
      }
      const target = position === undefined ? `commit ${hash}` : `the item at ${hash}:${position}`;
      errors.push(`Override keys '${claimingKey}' and '${overrideKey}' both match ${target}; keep one`);
      failedKeys.add(claimingKey);
      failedKeys.add(overrideKey);
    }
  }

  for (const [itemId, overrideKey] of itemIdToKey) {
    if (failedKeys.has(overrideKey)) {
      itemIdToKey.delete(itemId);
    }
  }
  return { errors, itemIdToKey };
}

// endregion | Helpers
