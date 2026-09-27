import { existsSync, readFileSync } from 'node:fs';

import { isRecord, isUnknownArray } from './typeGuards.ts';
import type { ChangelogEntry } from './types.ts';

/**
 * Reports whether a value parsed from JSON is a `ChangelogEntry`.
 *
 * Checks the entry's top level only: `sections` must be an array, and its contents pass through unvalidated.
 * `.meta/changelog.json` is written by release-kit and read tolerantly; strict validation applies to the
 * human-authored `.meta/changelog-overrides.json`, in `changelogOverrides.ts`.
 */
export function isChangelogEntry(value: unknown): value is ChangelogEntry {
  return (
    isRecord(value) &&
    typeof value['version'] === 'string' &&
    typeof value['date'] === 'string' &&
    isUnknownArray(value['sections'])
  );
}

/** Extracts the version from a tag: the text from its first `N.N.N` onward, or the whole tag when it contains none. */
export function extractVersion(tag: string): string {
  const match = /(\d+\.\d+\.\d+.*)$/.exec(tag);
  return match?.[1] ?? tag;
}

/** Reads the changelog entries in a JSON file; undefined when the file is missing, unreadable, or holds no array. */
export function readChangelogEntries(filePath: string): ChangelogEntry[] | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }
  try {
    const content = readFileSync(filePath, 'utf8');
    const parsed: unknown = JSON.parse(content);
    if (!isUnknownArray(parsed)) {
      return undefined;
    }
    return parsed.filter(isChangelogEntry);
  } catch {
    return undefined;
  }
}
