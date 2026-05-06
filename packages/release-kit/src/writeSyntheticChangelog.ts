import { prependChangelogSection } from './prependChangelogSection.ts';
import type { PropagationSource } from './types.ts';

/** Parameters for writing a synthetic changelog entry for propagated bumps. */
export interface WriteSyntheticChangelogParams {
  changelogPath: string;
  newVersion: string;
  date: string;
  propagatedFrom: PropagationSource[];
  dryRun?: boolean;
}

/**
 * Prepend a synthetic changelog section for workspaces bumped via dependency propagation.
 *
 * Creates the changelog file if it doesn't exist. Each propagated dependency is listed as
 * a bullet under a "Dependency updates" heading. Returns the changelog file path.
 */
export function writeSyntheticChangelog(params: WriteSyntheticChangelogParams): string {
  const { changelogPath, newVersion, date, propagatedFrom, dryRun = false } = params;
  const filePath = `${changelogPath}/CHANGELOG.md`;

  const bullets = propagatedFrom.map((dep) => `- Bumped \`${dep.packageName}\` to ${dep.newVersion}`).join('\n');

  const section = `## ${newVersion} — ${date}\n\n### Dependency updates\n\n${bullets}\n`;

  prependChangelogSection(filePath, section, dryRun);

  return filePath;
}
