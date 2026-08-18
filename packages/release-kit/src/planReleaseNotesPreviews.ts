import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describeError } from '@williamthorsen/toolbelt.errors';

import { extractVersion } from './changelogJsonUtils.ts';
import {
  renderInjectedReadmeFromEntries,
  type RenderInjectedReadmeSkipReason,
} from './injectReleaseNotesIntoReadme.ts';
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
 * for this version, with the reason recorded in `warnings`.
 */
export function planReleaseNotesPreviews(options: PlanReleaseNotesPreviewsOptions): ReleaseNotesPreviewsPlan {
  const { workspacePath, tag, entries, sectionOrder } = options;
  const warnings: string[] = [];

  const readmePath = path.join(workspacePath, 'README.md');
  const readme = readWorkspaceReadme(readmePath, warnings);

  const result = renderInjectedReadmeFromEntries(readme.content, entries, tag, sectionOrder);
  if (result.status === 'skipped') {
    warnings.push(describePreviewSkip(result.reason, result.version));
    return { writes: [], warnings };
  }
  const { rendered } = result;

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

/** Describes a skipped preview as a warning naming the reason and the version it applies to. */
function describePreviewSkip(reason: RenderInjectedReadmeSkipReason, version: string): string {
  return reason === 'no-entry'
    ? `no changelog entry for version ${version}; skipping release-notes previews`
    : `no user-facing release notes for version ${version}; skipping release-notes previews`;
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
    const message = describeError(error);
    warnings.push(`failed to read ${readmePath}: ${message}; skipping injected-README preview`);
    return { content: '', exists: false, unreadable: true };
  }
}
