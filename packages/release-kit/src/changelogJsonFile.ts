import { join } from 'node:path';

import { UserError } from '@williamthorsen/nmr-core';
import stringify from 'json-stringify-pretty-compact';

import { loadChangelogEntries } from './changelogJsonUtils.ts';
import { compareVersionsDescending } from './compareVersions.ts';
import type { ChangelogEntry, ReleaseSettings } from './types.ts';

/** Resolves the path of the `changelog.json` file under a workspace's changelog directory. */
export function resolveChangelogJsonPath(
  config: Pick<ReleaseSettings, 'changelogJson'>,
  changelogPath: string,
): string {
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
 * Keeps an on-disk entry that `entries` lacks, which preserves synthetic entries across propagation runs. A missing file
 * counts as empty. Throws a `UserError` when the file cannot be read as entries or contains an element that is not an
 * entry, because the merged set would replace the history that the file holds.
 */
export function mergeChangelogEntriesWithDisk(filePath: string, entries: ChangelogEntry[]): ChangelogEntry[] {
  return mergeEntries(entries, readExistingEntries(filePath));
}

/** Sorts changelog entries newest-first by SemVer-aware version comparison. */
function sortNewestFirst(entries: Iterable<ChangelogEntry>): ChangelogEntry[] {
  return [...entries].toSorted((a, b) => compareVersionsDescending(a.version, b.version));
}

/** Reads the changelog entries in a JSON file: none when the file is missing. */
function readExistingEntries(filePath: string): ChangelogEntry[] {
  const loaded = loadChangelogEntries(filePath);
  if (loaded.status === 'missing') {
    return [];
  }
  if (loaded.status === 'unreadable') {
    throw buildRefusal(filePath, loaded.reason);
  }
  if (loaded.rejectedCount > 0) {
    const elements =
      loaded.rejectedCount === 1 ? 'element is not a changelog entry' : 'elements are not changelog entries';
    throw buildRefusal(filePath, `${loaded.rejectedCount} ${elements}`);
  }
  return loaded.entries;
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

/** Builds the error that refuses to rewrite a changelog file that cannot be read as entries. */
function buildRefusal(filePath: string, problem: string): UserError {
  return new UserError(
    `Cannot prepare the changelog from ${filePath}: ${problem}. Repair or delete the file, then rerun 'release-kit prepare'.`,
  );
}
