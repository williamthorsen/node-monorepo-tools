import type { ChangelogEntry, ChangelogItem } from './types.ts';

/** Builds the changelog entry of a propagation-only bump, with one item per dependency whose bump propagated. */
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
