import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Directory, relative to a changelog directory, that contains the per-major archive files of its `CHANGELOG.md`. */
export const CHANGELOG_ARCHIVE_DIRECTORY = 'changelogs';

/** An archive file that exists on disk. */
export interface ChangelogArchivePath {
  major: number;
  path: string;
}

/** Returns the path, relative to the changelog directory, of the archive file for a major version. */
export function describeArchivePath(major: number): string {
  return `${CHANGELOG_ARCHIVE_DIRECTORY}/CHANGELOG-v${major}.md`;
}

/**
 * Lists the archive files under the changelog directory, newest major first. A missing archive directory has none;
 * files whose names do not match the archive pattern are ignored.
 */
export function listArchiveFiles(changelogDir: string): ChangelogArchivePath[] {
  const archiveDir = join(changelogDir, CHANGELOG_ARCHIVE_DIRECTORY);
  if (!existsSync(archiveDir)) {
    return [];
  }
  const archives: ChangelogArchivePath[] = [];
  for (const name of readdirSync(archiveDir)) {
    const match = ARCHIVE_FILE_PATTERN.exec(name);
    if (match?.[1] !== undefined) {
      archives.push({ major: Number(match[1]), path: join(archiveDir, name) });
    }
  }
  return archives.toSorted((a, b) => b.major - a.major);
}

// region | Helpers

/** Matches the name of an archive file and captures its major version. */
const ARCHIVE_FILE_PATTERN = /^CHANGELOG-v(\d+)\.md$/;

// endregion | Helpers
