import type { ChangelogEntry } from './types.ts';

/**
 * Build a synthetic changelog entry for a forced release whose unreleased window yields no changelog item.
 *
 * Produces a single `ChangelogEntry` with one `'Notes'` section (audience `'dev'`)
 * containing a single `'Forced version bump.'` item. Used when `release-kit prepare`
 * proceeds via `--force` or `--set-version` against a unit whose window
 * yields no item, whether or not it has commits. Pure function: no I/O.
 */
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
