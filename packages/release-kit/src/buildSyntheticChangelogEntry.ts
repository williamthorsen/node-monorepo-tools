import type { ChangelogEntry, ChangelogItem } from './types.ts';

/**
 * Builds the changelog entry of a propagation-only bump, with one item per dependency whose bump propagated, under
 * `sectionTitle`, the resolved `deps` work type's header.
 */
export function buildSyntheticChangelogEntry(
  propagatedFrom: ReadonlyArray<{ packageName: string; newVersion: string }>,
  version: string,
  date: string,
  sectionTitle: string,
): ChangelogEntry {
  const items: ChangelogItem[] = propagatedFrom.map((dependency) => ({
    description: `Bumped \`${dependency.packageName}\` to ${dependency.newVersion}`,
  }));

  return {
    version,
    date,
    sections: [{ title: sectionTitle, audience: 'dev', items }],
  };
}
