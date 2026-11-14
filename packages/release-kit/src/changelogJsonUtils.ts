import { existsSync, readFileSync } from 'node:fs';

import { isRecord } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { isUnknownArray } from './typeGuards.ts';
import type { ChangelogEntry } from './types.ts';

/**
 * Reports whether a value parsed from JSON is a `ChangelogEntry`.
 *
 * Checks the entry's top level only: `sections` must be an array, and its contents pass through unvalidated.
 * `.meta/changelog.json` is written by release-kit. Its readers skip a rejected entry, but `prepare`, which rewrites
 * the file, refuses one. Strict validation applies to the human-authored `.meta/changelog-overrides.json`, in
 * `loadChangelogOverrides.ts`.
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

/** Outcome of loading a changelog JSON file, telling a missing file apart from one that cannot be read as entries. */
export type ChangelogLoadResult =
  | {
      status: 'loaded';
      entries: ChangelogEntry[];
      /** The number of array elements that `isChangelogEntry` rejected, which `entries` leaves out. */
      rejectedCount: number;
    }
  | { status: 'missing' }
  | { status: 'unreadable'; reason: string };

/** Describes a changelog JSON file that could not be loaded, as a phrase naming the file. */
export function describeChangelogFileProblem(status: 'missing' | 'unreadable', filePath: string): string {
  return status === 'missing' ? `${filePath} not found` : `could not parse ${filePath}`;
}

/**
 * Loads the changelog entries in a JSON file. A file that cannot be read, is not valid JSON, or doesn't contain an
 * array is `unreadable`.
 */
export function loadChangelogEntries(filePath: string): ChangelogLoadResult {
  if (!existsSync(filePath)) {
    return { status: 'missing' };
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error: unknown) {
    return { status: 'unreadable', reason: describeError(error) };
  }
  if (!isUnknownArray(parsedJson)) {
    return { status: 'unreadable', reason: 'the top-level value is not an array' };
  }
  const entries = parsedJson.filter(isChangelogEntry);
  return { status: 'loaded', entries, rejectedCount: parsedJson.length - entries.length };
}

/**
 * Reads the changelog entries in a JSON file; undefined when the file is missing or unreadable, or doesn't contain an
 * array.
 */
export function readChangelogEntries(filePath: string): ChangelogEntry[] | undefined {
  const result = loadChangelogEntries(filePath);
  return result.status === 'loaded' ? result.entries : undefined;
}
