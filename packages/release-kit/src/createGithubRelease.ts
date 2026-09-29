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
 * Why a tag was skipped. `'no-entry'` covers every case of missing data (no changelog file, unparseable JSON, no entry
 * for the version); the warnings that `createGithubRelease` prints tell them apart.
 */
export type CreateReleaseSkipReason = 'no-entry' | 'no-audience-content' | 'empty-body';

/** Discriminated outcome of attempting to create a single GitHub Release. */
export type CreateReleaseResult = { status: 'created' } | { status: 'skipped'; reason: CreateReleaseSkipReason };

/**
 * Creates a GitHub Release for a tag through the `gh` CLI, with the all-audience notes of the tag's `changelog.json`
 * entry as its body.
 *
 * Returns a skip when the entry is missing (with a warning), doesn't have any all-audience content, or renders an empty
 * body. Throws when `gh` fails, so that the caller does not exit 0 on a failed release.
 */
export function createGithubRelease(options: CreateGithubReleaseOptions): CreateReleaseResult {
  const { tag, changelogJsonPath, dryRun, sectionOrder } = options;

  if (!existsSync(changelogJsonPath)) {
    console.warn(`Warning: ${changelogJsonPath} not found; skipping GitHub Release creation`);
    return { status: 'skipped', reason: 'no-entry' };
  }

  const version = extractVersion(tag);
  const entries = readChangelogEntries(changelogJsonPath);

  if (entries === undefined) {
    console.warn(`Warning: could not parse ${changelogJsonPath}; skipping GitHub Release creation`);
    return { status: 'skipped', reason: 'no-entry' };
  }

  const entry = entries.find((e) => e.version === version);
  if (entry === undefined) {
    console.warn(`Warning: no changelog entry for version ${version}; skipping GitHub Release creation`);
    return { status: 'skipped', reason: 'no-entry' };
  }

  if (!entry.sections.some(matchesAudience('all'))) {
    return { status: 'skipped', reason: 'no-audience-content' };
  }

  const body = renderReleaseNotesSingle(entry, {
    filter: matchesAudience('all'),
    includeHeading: false,
    ...(sectionOrder !== undefined && { sectionOrder }),
  });

  if (body.trim() === '') {
    return { status: 'skipped', reason: 'empty-body' };
  }

  const args = ['release', 'create', tag, '--title', tag, '--notes', body];

  if (dryRun) {
    console.info(`[dry-run] Would run: gh ${args.join(' ')}`);
    return { status: 'created' };
  }

  execFileSync('gh', args, { stdio: 'inherit' });
  return { status: 'created' };
}

/** Outcome of a `createGithubReleases` invocation. */
export interface CreateGithubReleasesOutcome {
  /** Tags for which a Release was created (or would be, under `--dry-run`). */
  created: string[];
  /** Tags that were skipped, paired with the discriminated reason for each skip. */
  skipped: Array<{ tag: string; reason: CreateReleaseSkipReason }>;
}

/** Creates a GitHub Release for each tag and records each skip with its reason; throws at once when `gh` fails. */
export function createGithubReleases(
  tags: Array<{ tag: string; workspacePath: string }>,
  changelogJsonOutputPath: string,
  dryRun: boolean,
  sectionOrder?: string[],
): CreateGithubReleasesOutcome {
  const created: string[] = [];
  const skipped: Array<{ tag: string; reason: CreateReleaseSkipReason }> = [];
  for (const { tag, workspacePath } of tags) {
    const changelogJsonPath = join(workspacePath, changelogJsonOutputPath);
    const result = createGithubRelease({
      tag,
      changelogJsonPath,
      dryRun,
      ...(sectionOrder !== undefined && { sectionOrder }),
    });
    if (result.status === 'created') {
      created.push(tag);
    } else {
      skipped.push({ tag, reason: result.reason });
    }
  }
  return { created, skipped };
}
