import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Prepend a pre-formatted section to a `CHANGELOG.md` file, creating the file if it does not exist.
 *
 * Reads any existing content, concatenates the new section ahead of it (separated by a blank line),
 * and writes the result back. In dry-run mode, performs no I/O. Shared by `writeEmptyReleaseChangelog`
 * and `writeSyntheticChangelog` so the file-level semantics stay consistent across synthetic-entry
 * paths.
 */
export function prependChangelogSection(filePath: string, section: string, dryRun: boolean): void {
  if (dryRun) {
    return;
  }

  let existingContent = '';
  if (existsSync(filePath)) {
    existingContent = readFileSync(filePath, 'utf8');
  }

  const newContent = `${section}\n${existingContent}`;

  writeFileSync(filePath, newContent, 'utf8');
}
