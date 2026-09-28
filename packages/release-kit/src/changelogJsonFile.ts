import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describeError } from '@williamthorsen/toolbelt.errors';
import stringify from 'json-stringify-pretty-compact';

import { isChangelogEntry } from './changelogJsonUtils.ts';
import { compareVersionsDescending } from './compareVersions.ts';
import { isUnknownArray } from './typeGuards.ts';
import type { ChangelogEntry, ReleaseConfig } from './types.ts';

/** Resolves the path of the `changelog.json` file under a workspace's changelog directory. */
export function resolveChangelogJsonPath(config: Pick<ReleaseConfig, 'changelogJson'>, changelogPath: string): string {
  return join(changelogPath, config.changelogJson.outputPath);
}

/** Renders changelog entries as a `changelog.json` file's complete content, sorted newest-first. */
export function renderChangelogJson(entries: ChangelogEntry[]): string {
  return stringify(sortNewestFirst(entries), { maxLength: 100 }) + '\n';
}

/**
 * Merges `entries` with the on-disk entries at `filePath` and returns the merged set in newest-first order, without
 * writing.
 *
 * Keeps an on-disk entry that `entries` lacks, which preserves synthetic entries across propagation runs. A missing or
 * malformed file counts as empty, so that a malformed file does not abort the release.
 */
export function mergeChangelogEntriesWithDisk(filePath: string, entries: ChangelogEntry[]): ChangelogEntry[] {
  const existing = readExistingEntries(filePath);
  return mergeEntries(entries, existing);
}

/** Sorts changelog entries newest-first by SemVer-aware version comparison. */
function sortNewestFirst(entries: Iterable<ChangelogEntry>): ChangelogEntry[] {
  return [...entries].toSorted((a, b) => compareVersionsDescending(a.version, b.version));
}

/**
 * Reads the changelog entries in a JSON file: none when the file is missing or holds no array, and none with a warning
 * on stderr when it cannot be read or parsed.
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
    console.warn(`Warning: could not parse existing ${filePath}: ${describeError(error)}; treating as empty`);
    return [];
  }
}

/** Merges new entries with existing ones; a new entry replaces an existing one of the same version. */
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
