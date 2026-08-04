import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { reportError, writeFileWithCheck } from '@williamthorsen/nmr-core';

import { extractVersion } from './changelogJsonUtils.ts';
import { dim } from './format.ts';
import { renderInjectedReadme, renderInjectedReadmeFromEntries } from './injectReleaseNotesIntoReadme.ts';
import type { PlannedWrite } from './releasePlan.ts';
import type { ChangelogEntry } from './types.ts';

/** Options for `planReleaseNotesPreviews`. */
export interface PlanReleaseNotesPreviewsOptions {
  /** Workspace root directory beneath which `docs/` is created. */
  workspacePath: string;
  /** Full release tag (e.g., `release-kit-v1.0.0`); used to extract the version for filenames. */
  tag: string;
  /** The workspace's changelog entries as the release will leave them, merged but not yet written. */
  entries: readonly ChangelogEntry[];
  /** Section titles in priority order, typically derived from `resolveWorkTypes(config.workTypes)`. */
  sectionOrder: string[];
}

/** Preview files a release will write, alongside the reasons any were left out. */
export interface ReleaseNotesPreviewsPlan {
  writes: PlannedWrite[];
  warnings: string[];
}

/**
 * Computes the per-workspace release-notes previews under `{workspacePath}/docs/` without
 * writing them:
 *
 * - `docs/README.v{version}.md` — the workspace README with release notes injected at the marker.
 * - `docs/RELEASE_NOTES.v{version}.md` — the standalone release notes for this version.
 *
 * Renders from the entries the release will write rather than from a saved `changelog.json`, so
 * a preview describes the release being prepared rather than the one already on disk.
 *
 * The injected-README preview is omitted (the standalone file is still planned) when the
 * workspace has no readable `README.md`. Both are omitted when the renderer reports no content
 * for this version, which it explains on stderr itself.
 */
export function planReleaseNotesPreviews(options: PlanReleaseNotesPreviewsOptions): ReleaseNotesPreviewsPlan {
  const { workspacePath, tag, entries, sectionOrder } = options;
  const warnings: string[] = [];

  const readmePath = path.join(workspacePath, 'README.md');
  const readme = readWorkspaceReadme(readmePath, warnings);

  const rendered = renderInjectedReadmeFromEntries(readme.content, entries, tag, sectionOrder);
  if (rendered === undefined) {
    return { writes: [], warnings };
  }

  if (!readme.exists && !readme.unreadable) {
    warnings.push(
      `${readmePath} not found; skipping injected-README preview but still writing standalone release notes`,
    );
  }

  const version = extractVersion(tag);
  const docsDir = path.join(workspacePath, 'docs');
  const writes: PlannedWrite[] = [];

  if (readme.exists) {
    writes.push({ path: path.join(docsDir, `README.v${version}.md`), content: rendered.injectedReadme });
  }

  // The standalone preview ends with a trailing newline for consistency with markdown files.
  writes.push({
    path: path.join(docsDir, `RELEASE_NOTES.v${version}.md`),
    content: rendered.releaseNotesMarkdown.endsWith('\n')
      ? rendered.releaseNotesMarkdown
      : `${rendered.releaseNotesMarkdown}\n`,
  });

  return { writes, warnings };
}

/**
 * Reads the workspace README, treating an unreadable file the same as a missing one.
 *
 * An empty string still lets the pure renderer produce the standalone release notes, so a
 * workspace with no README loses only the injected-README preview. A read may fail
 * independently of `existsSync` (race, permission error), which earns its own warning.
 */
function readWorkspaceReadme(
  readmePath: string,
  warnings: string[],
): { content: string; exists: boolean; unreadable: boolean } {
  if (!existsSync(readmePath)) {
    return { content: '', exists: false, unreadable: false };
  }

  try {
    return { content: readFileSync(readmePath, 'utf8'), exists: true, unreadable: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`failed to read ${readmePath}: ${message}; skipping injected-README preview`);
    return { content: '', exists: false, unreadable: true };
  }
}

/** Options for `writeReleaseNotesPreviews`. */
export interface WriteReleaseNotesPreviewsOptions {
  /** Workspace root directory beneath which `docs/` is created. */
  workspacePath: string;
  /** Full release tag (e.g., `release-kit-v1.0.0`); used to extract the version for filenames. */
  tag: string;
  /** Path to the workspace's `changelog.json` file. */
  changelogJsonPath: string;
  /** Section titles in priority order, typically derived from `resolveWorkTypes(config.workTypes)`. */
  sectionOrder: string[];
  /** When `true`, logs planned writes without creating any files. */
  dryRun: boolean;
}

/** Result of a single preview write attempt. */
export interface PreviewFileResult {
  filePath: string;
  outcome: 'created' | 'overwritten' | 'skipped-no-readme' | 'failed' | 'dry-run';
  error?: string;
}

/** Aggregate result of `writeReleaseNotesPreviews`. */
export interface WriteReleaseNotesPreviewsResult {
  /** Outcome for the injected README preview (undefined when the whole render was skipped). */
  injectedReadme?: PreviewFileResult;
  /** Outcome for the standalone release-notes preview (undefined when the whole render was skipped). */
  releaseNotes?: PreviewFileResult;
  /** True when `renderInjectedReadme` returned `undefined`, causing both writes to be skipped. */
  renderSkipped: boolean;
}

/**
 * Generate per-workspace release-notes previews under `{workspacePath}/docs/`:
 *
 * - `docs/README.v{version}.md` — the workspace README with release notes injected at the marker.
 * - `docs/RELEASE_NOTES.v{version}.md` — the standalone release notes for this version.
 *
 * The injected README file is skipped (but the standalone file is still written) when the
 * workspace has no `README.md`. If the renderer reports no content for this version
 * (no changelog entry, all sections dev-only, etc.), no files are written and a warning is
 * logged. Existing files at the same paths are overwritten.
 *
 * In dry-run mode, logs planned writes and returns without creating any files.
 */
export function writeReleaseNotesPreviews(options: WriteReleaseNotesPreviewsOptions): WriteReleaseNotesPreviewsResult {
  const { workspacePath, tag, changelogJsonPath, sectionOrder, dryRun } = options;

  const version = extractVersion(tag);
  const readmePath = path.join(workspacePath, 'README.md');
  // `readmeExists` tracks whether the injected-README preview should be written. The read may
  // succeed or fail independently of `existsSync` (race, permission error), so we treat an
  // unreadable file the same as a missing one but log a specific warning. An empty string lets
  // the pure renderer still produce the standalone release notes.
  let readmeExists = existsSync(readmePath);
  let readmeUnreadable = false;
  let readmeContent = '';
  if (readmeExists) {
    try {
      readmeContent = readFileSync(readmePath, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Warning: failed to read ${readmePath}: ${message}; skipping injected-README preview`);
      readmeExists = false;
      readmeUnreadable = true;
    }
  }

  // `renderInjectedReadme` logs its own specific skip reason (missing file, parse failure, no
  // matching version, or no public-audience sections) when it returns `undefined`. No additional
  // outer warning is emitted here to avoid two messages per skip event.
  const rendered = renderInjectedReadme(readmeContent, changelogJsonPath, tag, sectionOrder);
  if (rendered === undefined) {
    return { renderSkipped: true };
  }

  const docsDir = path.join(workspacePath, 'docs');
  const readmePreviewPath = path.join(docsDir, `README.v${version}.md`);
  const releaseNotesPreviewPath = path.join(docsDir, `RELEASE_NOTES.v${version}.md`);

  let injectedReadme: PreviewFileResult;
  if (readmeExists) {
    injectedReadme = writePreviewFile(readmePreviewPath, rendered.injectedReadme, dryRun);
  } else {
    if (!readmeUnreadable) {
      console.warn(
        `Warning: ${readmePath} not found; skipping injected-README preview but still writing standalone release notes`,
      );
    }
    // When unreadable, the specific read-failure warning was already logged above.
    injectedReadme = { filePath: readmePreviewPath, outcome: 'skipped-no-readme' };
  }

  // The standalone preview should end with a trailing newline for consistency with markdown files.
  const releaseNotesContent = rendered.releaseNotesMarkdown.endsWith('\n')
    ? rendered.releaseNotesMarkdown
    : `${rendered.releaseNotesMarkdown}\n`;
  const releaseNotes = writePreviewFile(releaseNotesPreviewPath, releaseNotesContent, dryRun);

  return { injectedReadme, releaseNotes, renderSkipped: false };
}

/** Write a preview file via `writeFileWithCheck` and log its outcome in the prepare-command style. */
function writePreviewFile(filePath: string, content: string, dryRun: boolean): PreviewFileResult {
  if (dryRun) {
    console.info(dim(`  [dry-run] Would write ${filePath}`));
    return { filePath, outcome: 'dry-run' };
  }

  const result = writeFileWithCheck(filePath, content, { dryRun: false, overwrite: true });

  if (result.outcome === 'failed') {
    reportError(`Failed to write ${filePath}: ${result.error ?? 'unknown error'}`);
    return { filePath, outcome: 'failed', ...(result.error !== undefined && { error: result.error }) };
  }

  // `writeFileWithCheck` with `overwrite: true` only returns 'created' or 'overwritten' on success.
  if (result.outcome === 'created' || result.outcome === 'overwritten') {
    console.info(dim(`  Wrote ${filePath}`));
    return { filePath, outcome: result.outcome };
  }

  // Defensive fallback — unreachable under the current `writeFileWithCheck` contract.
  return { filePath, outcome: 'failed', error: `unexpected outcome: ${result.outcome}` };
}
