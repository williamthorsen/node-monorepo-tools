import type { ChangelogEntry } from './types.ts';

/** Builds the changelog entry of a forced release whose unreleased window yields no changelog item. */
export function buildEmptyReleaseEntry(version: string, date: string): ChangelogEntry {
  return {
    version,
    date,
    sections: [
      {
        title: 'Notes',
        audience: 'dev',
        items: [{ description: 'Forced version bump.' }],
      },
    ],
  };
}
