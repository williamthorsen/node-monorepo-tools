import { existsSync, readFileSync } from 'node:fs';

import { isRecord, isUnknownArray } from './typeGuards.ts';
import type { ChangelogEntry } from './types.ts';

/** Type guard for `ChangelogEntry` values parsed from JSON. */
export function isChangelogEntry(value: unknown): value is ChangelogEntry {
  return (
    isRecord(value) &&
    typeof value.version === 'string' &&
    typeof value.date === 'string' &&
    isUnknownArray(value.sections)
  );
}

/** Extract the version from a tag by stripping the prefix up to the first digit. */
export function extractVersion(tag: string): string {
  const match = /(\d+\.\d+\.\d+.*)$/.exec(tag);
  return match?.[1] ?? tag;
}

/**
 * Read and parse a changelog JSON file, returning validated entries.
 *
 * Returns `undefined` if the file cannot be read or does not contain a valid array.
 * Silent on parse error — for the warn-and-treat-as-empty variant used by upsert callers,
 * see `readExistingEntries` in `./changelogJsonFile.ts`.
 */
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
