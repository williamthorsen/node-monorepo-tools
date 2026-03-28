import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** Parameters for writing a synthetic changelog entry for propagated bumps. */
export interface WriteSyntheticChangelogParams {
  changelogPath: string;
  newVersion: string;
  date: string;
  propagatedFrom: Array<{ packageName: string; newVersion: string }>;
  dryRun?: boolean;
}

/**
 * Prepend a synthetic changelog section for components bumped via dependency propagation.
 *
 * Creates the changelog file if it doesn't exist. Each propagated dependency is listed as
 * a bullet under a "Dependency updates" heading. Returns the changelog file path.
 */
export function writeSyntheticChangelog(params: WriteSyntheticChangelogParams): string {
  const { changelogPath, newVersion, date, propagatedFrom, dryRun } = params;
  const filePath = `${changelogPath}/CHANGELOG.md`;

  const bullets = propagatedFrom.map((dep) => `- Bumped \`${dep.packageName}\` to ${dep.newVersion}`).join('\n');

  const section = `## ${newVersion} — ${date}\n\n### Dependency updates\n\n${bullets}\n`;

  if (dryRun) {
    return filePath;
  }

  let existingContent = '';
  if (existsSync(filePath)) {
    existingContent = readFileSync(filePath, 'utf8');
  }

  const newContent = existingContent.length > 0 ? `${section}\n${existingContent}` : `${section}\n`;

  writeFileSync(filePath, newContent, 'utf8');

  return filePath;
}
