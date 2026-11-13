import { existsSync, readFileSync } from 'node:fs';

import { isRecord } from '@williamthorsen/nmr-core';

import { isUnknownArray } from './typeGuards.ts';
import type { ChangelogEntry } from './types.ts';

/**
 * Reports whether a value parsed from JSON is a `ChangelogEntry`.
 *
 * Checks the entry's top level only: `sections` must be an array, and its contents pass through unvalidated.
 * `.meta/changelog.json` is written by release-kit and read tolerantly; strict validation applies to the
 * human-authored `.meta/changelog-overrides.json`, in `loadChangelogOverrides.ts`.
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
  { status: 'loaded'; entries: ChangelogEntry[] } | { status: 'missing' } | { status: 'unreadable' };

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
  try {
    const content = readFileSync(filePath, 'utf8');
    const parsedJson: unknown = JSON.parse(content);
    if (!isUnknownArray(parsedJson)) {
      return { status: 'unreadable' };
    }
    return { status: 'loaded', entries: parsedJson.filter(isChangelogEntry) };
  } catch {
    return { status: 'unreadable' };
  }
}

/**
 * Reads the changelog entries in a JSON file; undefined when the file is missing or unreadable, or doesn't contain an
 * array.
 */
export function readChangelogEntries(filePath: string): ChangelogEntry[] | undefined {
  const result = loadChangelogEntries(filePath);
  return result.status === 'loaded' ? result.entries : undefined;
}
