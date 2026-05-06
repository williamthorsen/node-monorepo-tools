import type { ChangelogEntry } from './types.ts';

/**
 * Build a synthetic changelog entry for a forced empty-range release.
 *
 * Produces a single `ChangelogEntry` with one `'Notes'` section (audience `'dev'`)
 * containing a single `'Forced version bump.'` item. Used when `release-kit prepare`
 * proceeds via `--force`, `--bump=X`, or `--set-version` against a unit with zero
 * qualifying commits since its last tag. Pure function: no I/O.
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
