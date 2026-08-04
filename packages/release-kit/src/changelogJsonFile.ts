import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import stringify from 'json-stringify-pretty-compact';
import semver from 'semver';

import { isChangelogEntry } from './changelogJsonUtils.ts';
import { isUnknownArray } from './typeGuards.ts';
import type { ChangelogEntry, ReleaseConfig } from './types.ts';

/** Resolve the absolute output path for the `changelog.json` file under a workspace's changelog directory. */
export function resolveChangelogJsonPath(config: Pick<ReleaseConfig, 'changelogJson'>, changelogPath: string): string {
  return join(changelogPath, config.changelogJson.outputPath);
}

/** Renders changelog entries as a `changelog.json` file's complete content, sorted newest-first. */
export function renderChangelogJson(entries: ChangelogEntry[]): string {
  return stringify(sortNewestFirst(entries), { maxLength: 100 }) + '\n';
}

/**
 * Merges `entries` with the on-disk entries at `filePath` and returns the merged set in
 * newest-first order, without writing.
 *
 * Preserves entries that exist on disk but are absent from `entries` — load-bearing for
 * synthetic-entry preservation across propagation runs. Reads the file when present; treats a
 * missing or malformed file as an empty existing set, so a malformed file does not abort the
 * release.
 */
export function mergeChangelogEntriesWithDisk(filePath: string, entries: ChangelogEntry[]): ChangelogEntry[] {
  const existing = readExistingEntries(filePath);
  return mergeEntries(entries, existing);
}

/** Sort changelog entries newest-first by SemVer-aware version comparison. */
function sortNewestFirst(entries: Iterable<ChangelogEntry>): ChangelogEntry[] {
  // eslint-disable-next-line unicorn/no-array-sort -- spread already creates a fresh copy; toSorted requires Node >=20
  return [...entries].sort((a, b) => compareVersionsDescending(a.version, b.version));
}

/**
 * Read existing changelog entries from a JSON file, if it exists.
 *
 * Warns to stderr and returns `[]` on parse error — load-bearing for synthetic-entry
 * preservation. For the silent-`undefined` variant used by render paths, see
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

/**
 * Compare two version strings in descending order (newest first).
 *
 * Valid SemVer inputs are ordered per SemVer §11 (delegated to `semver.rcompare`): prerelease
 * versions precede the corresponding release (`1.2.3-alpha < 1.2.3`), and build metadata is
 * ignored for ordering. Inputs that fail `semver.valid` sort to the bottom of the descending
 * list, ordered lexically among themselves. The comparator never throws.
 */
function compareVersionsDescending(a: string, b: string): number {
  const aValid = semver.valid(a);
  const bValid = semver.valid(b);
  if (aValid && bValid) return semver.rcompare(aValid, bValid);
  if (aValid) return -1;
  if (bValid) return 1;
  if (a > b) return -1;
  if (a < b) return 1;
  return 0;
}
