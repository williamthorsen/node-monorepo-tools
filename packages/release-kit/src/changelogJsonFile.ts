import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import stringify from 'json-stringify-pretty-compact';

import { isChangelogEntry } from './changelogJsonUtils.ts';
import { isUnknownArray } from './typeGuards.ts';
import type { ChangelogEntry, ReleaseConfig } from './types.ts';

/** Resolve the absolute output path for the `changelog.json` file under a workspace's changelog directory. */
export function resolveChangelogJsonPath(config: Pick<ReleaseConfig, 'changelogJson'>, changelogPath: string): string {
  return join(changelogPath, config.changelogJson.outputPath);
}

/**
 * Write changelog entries to disk, sorted newest-first. Overwrites unconditionally — does not
 * read the existing file. Returns the file path written.
 */
export function writeChangelogJson(filePath: string, entries: ChangelogEntry[]): string {
  const sorted = sortNewestFirst(entries);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, stringify(sorted, { maxLength: 100 }) + '\n', 'utf8');
  return filePath;
}

/**
 * Read existing changelog entries, merge with the new entries (new wins on version match), sort
 * newest-first, and write the result. Returns the file path written.
 *
 * Preserves entries that exist in the file but are absent from `entries` — load-bearing for
 * synthetic-entry preservation across propagation runs. Soft-fails on parse error: warns and
 * treats the existing file as empty, so a malformed file does not abort the release.
 */
export function upsertChangelogJson(filePath: string, entries: ChangelogEntry[]): string {
  const existing = readExistingEntries(filePath);
  const merged = mergeEntries(entries, existing);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, stringify(merged, { maxLength: 100 }) + '\n', 'utf8');
  return filePath;
}

/** Sort changelog entries newest-first by parsed version parts. */
function sortNewestFirst(entries: Iterable<ChangelogEntry>): ChangelogEntry[] {
  // eslint-disable-next-line unicorn/no-array-sort -- spread already creates a fresh copy; toSorted requires Node >=20
  return [...entries].sort((a, b) => compareVersionsDescending(a.version, b.version));
}

/**
 * Read existing changelog entries from a JSON file, if it exists.
 *
 * Warns to stderr and returns `[]` on parse error — load-bearing for synthetic-entry preservation
 * in upsert callers. For the silent-`undefined` variant used by render paths, see
 * `readChangelogEntries` in `./changelogJsonUtils.ts`.
 */
function readExistingEntries(filePath: string): ChangelogEntry[] {
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const content = readFileSync(filePath, 'utf8');
    const parsed: unknown = JSON.parse(content);
    if (!isUnknownArray(parsed)) {
      return [];
    }
    return parsed.filter(isChangelogEntry);
  } catch (error: unknown) {
    console.warn(
      `Warning: could not parse existing ${filePath}: ${error instanceof Error ? error.message : String(error)}; treating as empty`,
    );
    return [];
  }
}

/** Merge new entries with existing ones, replacing entries with matching versions. */
function mergeEntries(newEntries: ChangelogEntry[], existingEntries: ChangelogEntry[]): ChangelogEntry[] {
  const versionMap = new Map<string, ChangelogEntry>();

  for (const entry of existingEntries) {
    versionMap.set(entry.version, entry);
  }
  for (const entry of newEntries) {
    versionMap.set(entry.version, entry);
  }

  return sortNewestFirst(versionMap.values());
}

/** Parse a version string into numeric parts for comparison. */
function parseVersionParts(version: string): number[] {
  return version.split('.').map((s) => {
    const n = Number(s);
    return Number.isNaN(n) ? 0 : n;
  });
}

/** Compare two version strings in descending order (newest first). */
function compareVersionsDescending(a: string, b: string): number {
  const partsA = parseVersionParts(a);
  const partsB = parseVersionParts(b);
  for (let i = 0; i < 3; i++) {
    const diff = (partsB[i] ?? 0) - (partsA[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
