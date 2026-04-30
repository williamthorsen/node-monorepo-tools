import type { ChangelogEntry, ChangelogItem } from './types.ts';

/**
 * Build a synthetic changelog entry for a propagation-only bump.
 *
 * Produces a single `ChangelogEntry` with one `'Dependency updates'` section (audience `'dev'`)
 * containing one item per propagated-from dependency. Pure function: no I/O.
 */
export function buildSyntheticChangelogEntry(
  propagatedFrom: ReadonlyArray<{ packageName: string; newVersion: string }>,
  version: string,
  date: string,
): ChangelogEntry {
  const items: ChangelogItem[] = propagatedFrom.map((dep) => ({
    description: `Bumped \`${dep.packageName}\` to ${dep.newVersion}`,
  }));

  return {
    version,
    date,
    sections: [{ title: 'Dependency updates', audience: 'dev', items }],
  };
}
