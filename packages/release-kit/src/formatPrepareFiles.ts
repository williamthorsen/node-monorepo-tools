import { formatStatusLine, type OutputStyle } from '@williamthorsen/nmr-core';

import { dim } from './format.ts';
import type { ReleasedPackageResult } from './types.ts';

/** Appends bump file detail lines. */
export function formatBumpFiles(
  lines: string[],
  workspace: Pick<ReleasedPackageResult, 'bumpedFiles'>,
  isDryRun: boolean,
  indent = '',
): void {
  for (const file of workspace.bumpedFiles) {
    if (isDryRun) {
      lines.push(dim(`${indent}  [dry-run] Would bump ${file}`));
    } else {
      lines.push(dim(`${indent}  Bumped ${file}`));
    }
  }
}

/**
 * Appends a line per generated changelog file, each followed by the versions kept from the existing changelog and a
 * warning naming the sections dropped for lacking a version, then a line per removed changelog archive file.
 */
export function formatChangelogFiles(
  lines: string[],
  release: Pick<ReleasedPackageResult, 'changelogFiles' | 'changelogPreservation' | 'removedChangelogFiles'>,
  isDryRun: boolean,
  style: OutputStyle,
  indent = '',
): void {
  for (const file of release.changelogFiles) {
    if (isDryRun) {
      lines.push(dim(`${indent}  [dry-run] Would generate changelog: ${file}`));
    } else {
      lines.push(dim(`${indent}  Generating changelog: ${file}`));
    }
    const preservation = release.changelogPreservation?.find((candidate) => candidate.file === file);
    if (preservation === undefined) {
      continue;
    }
    if (preservation.preservedVersions.length > 0) {
      lines.push(dim(`${indent}    Kept from the existing changelog: ${preservation.preservedVersions.join(', ')}`));
    }
    const droppedHeadings = preservation.droppedUnversionedHeadings;
    if (droppedHeadings.length === 0) {
      continue;
    }
    const message = `Dropped ${droppedHeadings.length} section${droppedHeadings.length === 1 ? '' : 's'} without a version: ${droppedHeadings.join(', ')}`;
    lines.push(`${indent}    ${formatStatusLine(style, 'warning', message)}`);
  }
  const removedFiles = release.removedChangelogFiles ?? [];
  for (const file of removedFiles) {
    if (isDryRun) {
      lines.push(dim(`${indent}  [dry-run] Would remove changelog: ${file}`));
    } else {
      lines.push(dim(`${indent}  Removing changelog: ${file}`));
    }
  }
}

/** Appends release-notes preview file lines, which are present only under `--with-release-notes`. */
export function formatPreviewFiles(
  lines: string[],
  release: Pick<ReleasedPackageResult, 'previewFiles'>,
  isDryRun: boolean,
  indent = '',
): void {
  const previewFiles = release.previewFiles ?? [];
  for (const file of previewFiles) {
    if (isDryRun) {
      lines.push(dim(`${indent}  [dry-run] Would write ${file}`));
    } else {
      lines.push(dim(`${indent}  Wrote ${file}`));
    }
  }
}
