import { existsSync, readFileSync } from 'node:fs';

import { isRecord, isUnknownArray } from './typeGuards.ts';
import type { ChangelogEntry, ChangelogItem } from './types.ts';

/**
 * Type guard for `ChangelogItem` values parsed from JSON.
 *
 * Accepts the required `description` plus optional `body`, `breaking`, and `hash` fields. The
 * `hash` field is shape-checked but not required — synthetic propagation entries omit it, and
 * pre-hash `changelog.json` files are still considered valid.
 */
export function isChangelogItem(value: unknown): value is ChangelogItem {
  if (!isRecord(value)) return false;
  if (typeof value.description !== 'string') return false;
  if (value.body !== undefined && typeof value.body !== 'string') return false;
  if (value.breaking !== undefined && typeof value.breaking !== 'boolean') return false;
  if (value.hash !== undefined && typeof value.hash !== 'string') return false;
  return true;
}

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
