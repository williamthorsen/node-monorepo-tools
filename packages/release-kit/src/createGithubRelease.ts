import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { extractVersion, readChangelogEntries } from './changelogJsonUtils.ts';
import { matchesAudience, renderReleaseNotesSingle } from './renderReleaseNotes.ts';

/** Options for creating a GitHub Release. */
export interface CreateGithubReleaseOptions {
  tag: string;
  changelogJsonPath: string;
  dryRun: boolean;
  /** Section titles in priority order. When omitted, entry order is preserved. */
  sectionOrder?: string[];
}

/**
 * Create a GitHub Release from changelog.json using the `gh` CLI.
 *
 * Reads the changelog JSON, finds the entry matching the tag's version, renders all-audience
 * release notes, and creates the release. Returns `false` (with a warning) when the changelog
 * entry is missing, unparseable, or contains no all-audience content. Throws when the `gh` CLI
 * invocation itself fails so callers can surface the failure rather than exit 0 silently.
 */
export function createGithubRelease(options: CreateGithubReleaseOptions): boolean {
  const { tag, changelogJsonPath, dryRun, sectionOrder } = options;

  if (!existsSync(changelogJsonPath)) {
    console.warn(`Warning: ${changelogJsonPath} not found; skipping GitHub Release creation`);
    return false;
  }

  const version = extractVersion(tag);
  const entries = readChangelogEntries(changelogJsonPath);

  if (entries === undefined) {
    console.warn(`Warning: could not parse ${changelogJsonPath}; skipping GitHub Release creation`);
    return false;
  }

  const entry = entries.find((e) => e.version === version);
  if (entry === undefined) {
    console.warn(`Warning: no changelog entry for version ${version}; skipping GitHub Release creation`);
    return false;
  }

  if (!entry.sections.some(matchesAudience('all'))) {
    return false;
  }

  const body = renderReleaseNotesSingle(entry, {
    filter: matchesAudience('all'),
    includeHeading: false,
    ...(sectionOrder === undefined ? {} : { sectionOrder }),
  });

  if (body.trim() === '') {
    return false;
  }

  const args = ['release', 'create', tag, '--title', tag, '--notes', body];

  if (dryRun) {
    console.info(`[dry-run] Would run: gh ${args.join(' ')}`);
    return true;
  }

  execFileSync('gh', args, { stdio: 'inherit' });
  return true;
}

/** Outcome of a `createGithubReleases` invocation. */
export interface CreateGithubReleasesOutcome {
  /** Tags for which a Release was created (or would be, under `--dry-run`). */
  created: string[];
  /** Tags that were skipped with a soft-fail (missing changelog entry, no all-audience content, etc.). */
  skipped: string[];
}

/**
 * Create GitHub Releases for each provided tag.
 *
 * Per-tag soft-fails (missing changelog entry, no all-audience content, empty rendered body) are
 * recorded in `skipped` and do not throw. Hard failures from the `gh` CLI itself throw and
 * short-circuit the loop so callers can surface them.
 */
export function createGithubReleases(
  tags: Array<{ tag: string; workspacePath: string }>,
  changelogJsonOutputPath: string,
  dryRun: boolean,
  sectionOrder?: string[],
): CreateGithubReleasesOutcome {
  const created: string[] = [];
  const skipped: string[] = [];
  for (const { tag, workspacePath } of tags) {
    const changelogJsonPath = join(workspacePath, changelogJsonOutputPath);
    const result = createGithubRelease({
      tag,
      changelogJsonPath,
      dryRun,
      ...(sectionOrder === undefined ? {} : { sectionOrder }),
    });
    (result ? created : skipped).push(tag);
  }
  return { created, skipped };
}
