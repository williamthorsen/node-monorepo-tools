import { prependChangelogSection } from './prependChangelogSection.ts';

/** Parameters for writing a synthetic changelog entry for a forced empty-range release. */
export interface WriteEmptyReleaseChangelogParams {
  changelogPath: string;
  newVersion: string;
  date: string;
  dryRun?: boolean;
}

/**
 * Prepend a synthetic changelog section for a forced empty-range release.
 *
 * Creates the changelog file if it doesn't exist. The section contains a single
 * `- Forced version bump.` bullet under a "Notes" heading. Returns the changelog
 * file path. Mirrors `writeSyntheticChangelog`'s I/O semantics so empty-range and
 * propagation-only paths behave identically at the file level.
 */
export function writeEmptyReleaseChangelog(params: WriteEmptyReleaseChangelogParams): string {
  const { changelogPath, newVersion, date, dryRun = false } = params;
  const filePath = `${changelogPath}/CHANGELOG.md`;

  const section = `## ${newVersion} — ${date}\n\n### Notes\n\n- Forced version bump.\n`;

  prependChangelogSection(filePath, section, dryRun);

  return filePath;
}
