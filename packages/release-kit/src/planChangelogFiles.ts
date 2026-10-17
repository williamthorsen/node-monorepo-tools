import { join as joinPath } from 'node:path';

import { describeArchivePath, listArchiveFiles } from './changelogArchive.ts';
import { mergeChangelogEntriesWithDisk, renderChangelogJson, resolveChangelogJsonPath } from './changelogJsonFile.ts';
import { planPreservedSections } from './readChangelogSections.ts';
import type { PlannedWrite } from './releasePlan.ts';
import { renderChangelogFiles } from './renderChangelogMarkdown.ts';
import type { ChangelogEntry, ChangelogPreservation, ReleaseSettings } from './types.ts';

/**
 * Plans the `changelog.json` (when enabled), `CHANGELOG.md`, and archive files of one changelog directory from the new
 * entries merged with the entries on disk, so that the markdown includes prior releases whether or not the JSON is
 * written. Also plans the removal of every existing archive file that the render does not produce.
 */
export function planChangelogFiles(
  changelogDir: string,
  newEntries: ChangelogEntry[],
  settings: Pick<ReleaseSettings, 'changelogJson' | 'changelogMarkdown'>,
  sectionOrder: string[],
): {
  /** The `CHANGELOG.md`, then its archive files. */
  changelogFiles: string[];
  changelogJsonFiles: string[];
  entries: ChangelogEntry[];
  preservation: ChangelogPreservation | undefined;
  removals: string[];
  writes: PlannedWrite[];
} {
  const jsonPath = resolveChangelogJsonPath(settings, changelogDir);
  const entries = mergeChangelogEntriesWithDisk(jsonPath, newEntries);
  const writes: PlannedWrite[] = [];
  const changelogJsonFiles: string[] = [];

  if (settings.changelogJson.enabled) {
    writes.push({ path: jsonPath, content: renderChangelogJson(entries) });
    changelogJsonFiles.push(jsonPath);
  }

  const changelogFile = joinPath(changelogDir, 'CHANGELOG.md');
  const preserved = planPreservedSections(changelogDir, entries);
  const keepVersions = settings.changelogMarkdown?.keepVersions;
  const rendered = renderChangelogFiles(entries, {
    sectionOrder,
    preservedSections: preserved.sections,
    ...(keepVersions !== undefined && { keepVersions }),
  });
  writes.push({ path: changelogFile, content: rendered.main });

  const archiveFiles: string[] = [];
  for (const { major, content } of rendered.archives) {
    const path = joinPath(changelogDir, describeArchivePath(major));
    writes.push({ path, content });
    archiveFiles.push(path);
  }
  const removals = listArchiveFiles(changelogDir)
    .map((archive) => archive.path)
    .filter((path) => !archiveFiles.includes(path));

  return {
    changelogFiles: [changelogFile, ...archiveFiles],
    changelogJsonFiles,
    entries,
    preservation: preserved.preservation,
    removals,
    writes,
  };
}
