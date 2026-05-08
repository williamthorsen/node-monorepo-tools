import { existsSync, readFileSync } from 'node:fs';

import { isRecord } from './typeGuards.ts';
import type { ChangelogEntry, ChangelogItem, ChangelogOverride, ChangelogSection } from './types.ts';

/** Allowed audience values declared in the on-disk override format (full forward-compatible vocabulary). */
const VALID_AUDIENCE_VALUES = new Set(['all', 'dev', 'skip']);

/** Fields v1 supports at runtime. `'all'` and `'dev'` are reserved for v2 reclassification. */
const V1_SUPPORTED_AUDIENCE_VALUES = new Set(['skip']);

/** Known fields on a single override entry; presence of any other field is a validation error. */
const KNOWN_OVERRIDE_FIELDS = new Set(['audience', 'description', 'body', 'breaking']);

/** Result of loading an override file: either parsed overrides or a list of structured errors. */
export type LoadChangelogOverridesResult = { overrides: Map<string, ChangelogOverride> } | { errors: string[] };

/**
 * Load and validate the editorial overrides file at `path`.
 *
 * - Missing file resolves to an empty map (no-op default; matches "absent file → unchanged behavior").
 * - Malformed JSON, wrong top-level shape, or any per-entry validation failure surfaces as
 *   structured errors. Callers decide how to surface them.
 *
 * Returns either `{ overrides: Map }` on success or `{ errors: string[] }` on failure. Pure
 * except for the single file read; performs no other I/O.
 */
export function loadChangelogOverrides(path: string): LoadChangelogOverridesResult {
  if (!existsSync(path)) {
    return { overrides: new Map() };
  }

  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch (error: unknown) {
    return {
      errors: [`Failed to read override file ${path}: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    return {
      errors: [`Failed to parse override file ${path}: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const result = validateChangelogOverrides(parsed);
  if (result.errors.length > 0) {
    return { errors: result.errors };
  }
  return { overrides: result.overrides };
}

/**
 * Validate a parsed override record. Returns the parsed `Map` along with any error messages.
 *
 * Each error names the offending key (e.g. `overrides['abc']: 'audience' must be one of …`)
 * so the consumer can locate it in their override file.
 */
export function validateChangelogOverrides(raw: unknown): {
  overrides: Map<string, ChangelogOverride>;
  errors: string[];
} {
  const overrides = new Map<string, ChangelogOverride>();
  const errors: string[] = [];

  if (!isRecord(raw)) {
    errors.push('Override file: top-level value must be an object keyed by commit hash');
    return { overrides, errors };
  }

  for (const [key, rawEntry] of Object.entries(raw)) {
    if (key === '') {
      errors.push('Override file: empty-string key is not a valid commit hash');
      continue;
    }
    const validated = validateSingleOverride(key, rawEntry, errors);
    if (validated !== undefined) {
      overrides.set(key, validated);
    }
  }

  return { overrides, errors };
}

/**
 * Validate a single override entry for `key`. Returns the parsed `ChangelogOverride` on
 * success, or `undefined` after pushing one or more errors for invalid entries.
 */
function validateSingleOverride(key: string, rawEntry: unknown, errors: string[]): ChangelogOverride | undefined {
  if (!isRecord(rawEntry)) {
    errors.push(`overrides['${key}']: must be an object`);
    return undefined;
  }

  let entryValid = true;
  for (const fieldName of Object.keys(rawEntry)) {
    if (!KNOWN_OVERRIDE_FIELDS.has(fieldName)) {
      errors.push(`overrides['${key}']: unknown field '${fieldName}'`);
      entryValid = false;
    }
  }

  const result: ChangelogOverride = {};
  if (rawEntry.audience !== undefined) {
    const audienceResult = validateAudience(key, rawEntry.audience, errors);
    if (audienceResult === undefined) {
      entryValid = false;
    } else {
      result.audience = audienceResult;
    }
  }

  if (rawEntry.description !== undefined) {
    if (typeof rawEntry.description !== 'string') {
      errors.push(`overrides['${key}']: 'description' must be a string`);
      entryValid = false;
    } else {
      result.description = rawEntry.description;
    }
  }

  if (rawEntry.body !== undefined) {
    if (typeof rawEntry.body !== 'string') {
      errors.push(`overrides['${key}']: 'body' must be a string`);
      entryValid = false;
    } else {
      result.body = rawEntry.body;
    }
  }

  if (rawEntry.breaking !== undefined) {
    if (typeof rawEntry.breaking !== 'boolean') {
      errors.push(`overrides['${key}']: 'breaking' must be a boolean`);
      entryValid = false;
    } else {
      result.breaking = rawEntry.breaking;
    }
  }

  if (Object.keys(result).length === 0 && entryValid) {
    errors.push(`overrides['${key}']: at least one override field must be set`);
    return undefined;
  }

  if (!entryValid) {
    return undefined;
  }
  return result;
}

/**
 * Validate the `audience` field. v1 accepts only `'skip'`; the on-disk format declares the
 * full `'all' | 'dev' | 'skip'` vocabulary so future v2 reclassification needs no schema
 * change. `'all'` and `'dev'` are rejected with an explicit "not yet supported" error.
 */
function validateAudience(key: string, value: unknown, errors: string[]): 'all' | 'dev' | 'skip' | undefined {
  if (typeof value !== 'string' || !VALID_AUDIENCE_VALUES.has(value)) {
    errors.push(`overrides['${key}']: 'audience' must be one of 'all' | 'dev' | 'skip'`);
    return undefined;
  }
  if (!V1_SUPPORTED_AUDIENCE_VALUES.has(value)) {
    errors.push(`overrides['${key}']: audience '${value}' is not yet supported; only 'skip' is currently accepted`);
    return undefined;
  }
  // value is one of 'all' | 'dev' | 'skip' (verified above), and v1-supported.
  if (value === 'all' || value === 'dev' || value === 'skip') {
    return value;
  }
  return undefined;
}

/**
 * Apply overrides to a `ChangelogEntry[]`, returning a new array. Pure: no mutation, no I/O.
 *
 * Match algorithm: each override key is treated as a string-prefix against `ChangelogItem.hash`.
 * - 0 matches → warning (likely stale reference after a rebase).
 * - 1 match → apply each present override field to the matched item.
 * - 2+ matches → error (ambiguous prefix).
 *
 * v1 audience semantics:
 * - `'skip'` removes the matched item from its containing section. Empty sections are pruned.
 *   Versions with zero sections still appear (matches existing "empty workspace" behavior).
 * - `'all'` and `'dev'` are validated out before reaching the applier.
 *
 * Items without a `hash` (synthetic propagation entries) are never matched and pass through.
 *
 * The function does not throw; warnings/errors accumulate and are returned alongside the
 * transformed entries so the caller decides whether to abort or log-and-continue.
 */
export function applyChangelogOverrides(
  entries: ChangelogEntry[],
  overrides: Map<string, ChangelogOverride>,
): { entries: ChangelogEntry[]; warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (overrides.size === 0) {
    return { entries: entries.map(cloneEntry), warnings, errors };
  }

  // Pre-compute every hash present in the entry tree so each override key can resolve its
  // matches in one pass over the keyset rather than re-walking the tree per key.
  const allHashes: string[] = [];
  for (const entry of entries) {
    for (const section of entry.sections) {
      for (const item of section.items) {
        if (item.hash !== undefined) {
          allHashes.push(item.hash);
        }
      }
    }
  }

  // Resolve each override key to its set of matching hashes, accumulating warnings/errors for
  // 0-match and ambiguous-prefix cases.
  const keyToMatchedHashes = new Map<string, string[]>();
  for (const overrideKey of overrides.keys()) {
    const matches = allHashes.filter((hash) => hash.startsWith(overrideKey));
    if (matches.length === 0) {
      warnings.push(
        `Override key '${overrideKey}' did not match any commit hash in the changelog (likely a stale reference)`,
      );
      continue;
    }
    if (matches.length > 1) {
      errors.push(
        `Override key '${overrideKey}' is ambiguous: matches multiple commits (${matches.join(', ')}). ` +
          'Use a longer prefix or the full commit hash.',
      );
      continue;
    }
    keyToMatchedHashes.set(overrideKey, matches);
  }

  // Build a hash → override lookup so the iteration loop can dispatch overrides per item.
  const hashToOverride = new Map<string, ChangelogOverride>();
  for (const [overrideKey, matchedHashes] of keyToMatchedHashes) {
    const override = overrides.get(overrideKey);
    if (override === undefined) continue;
    for (const hash of matchedHashes) {
      hashToOverride.set(hash, override);
    }
  }

  // Walk the entry → version → section → item tree once, applying overrides and pruning
  // skipped items. This is the dispatch site for current and future per-item override
  // operations; v2 audience reclassification slots in here as a new dispatch branch.
  const transformedEntries: ChangelogEntry[] = [];
  for (const entry of entries) {
    const transformedSections: ChangelogSection[] = [];
    for (const section of entry.sections) {
      const transformedItems = applyOverridesToItems(section.items, hashToOverride);
      if (transformedItems.length === 0) {
        continue;
      }
      transformedSections.push({ ...section, items: transformedItems });
    }
    transformedEntries.push({ ...entry, sections: transformedSections });
  }

  return { entries: transformedEntries, warnings, errors };
}

/** Apply per-item overrides, dropping items whose `audience` resolves to `'skip'`. */
function applyOverridesToItems(
  items: ChangelogItem[],
  hashToOverride: Map<string, ChangelogOverride>,
): ChangelogItem[] {
  const result: ChangelogItem[] = [];
  for (const item of items) {
    if (item.hash === undefined) {
      result.push(cloneItem(item));
      continue;
    }
    const override = hashToOverride.get(item.hash);
    if (override === undefined) {
      result.push(cloneItem(item));
      continue;
    }
    if (override.audience === 'skip') {
      // Drop the item.
      continue;
    }
    result.push(applyOverrideToItem(item, override));
  }
  return result;
}

/**
 * Apply a single override's per-field replacements to a `ChangelogItem`.
 *
 * Replaces `description`, `body`, and `breaking` when each is present on the override.
 * Leaves the original `hash` intact so future override applications continue to match.
 */
function applyOverrideToItem(item: ChangelogItem, override: ChangelogOverride): ChangelogItem {
  const result: ChangelogItem = { ...item };
  if (override.description !== undefined) {
    result.description = override.description;
  }
  if (override.body !== undefined) {
    result.body = override.body;
  }
  if (override.breaking !== undefined) {
    result.breaking = override.breaking;
  }
  return result;
}

/** Shallow-clone a `ChangelogItem` so callers receive a fresh array of items. */
function cloneItem(item: ChangelogItem): ChangelogItem {
  return { ...item };
}

/** Shallow-clone a `ChangelogEntry` and its sections so the no-op path returns a fresh array. */
function cloneEntry(entry: ChangelogEntry): ChangelogEntry {
  return {
    ...entry,
    sections: entry.sections.map((section) => ({ ...section, items: section.items.map(cloneItem) })),
  };
}
