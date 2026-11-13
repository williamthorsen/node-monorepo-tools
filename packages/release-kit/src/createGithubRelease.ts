import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { extractVersion, loadChangelogEntries } from './changelogJsonUtils.ts';
import { matchesAudience, renderReleaseNotesSingle } from './renderReleaseNotes.ts';
import { asUserError } from './user-error-chaining.ts';

/** Options for creating a GitHub Release. */
export interface CreateGithubReleaseOptions {
  tag: string;
  changelogJsonPath: string;
  isDryRun: boolean;
  /** Section titles in priority order. When omitted, entry order is preserved. */
  sectionOrder?: string[];
}

/**
 * Why a tag was skipped. `'missing-file'` and `'unreadable-file'` concern the `changelog.json` itself; the others mean
 * that the file does not contain releasable content for the tag.
 */
export type CreateReleaseSkipReason =
  'missing-file' | 'unreadable-file' | 'no-entry' | 'no-audience-content' | 'empty-body';

/** Discriminated outcome of attempting to create a single GitHub Release. */
export type CreateReleaseResult = { status: 'created' } | { status: 'skipped'; reason: CreateReleaseSkipReason };

/**
 * Creates a GitHub Release for a tag through the `gh` CLI, with the all-audience notes of the tag's `changelog.json`
 * entry as its body.
 *
 * Returns a skip when the changelog is missing or unreadable, the entry is missing, doesn't have any all-audience
 * content, or renders an empty body. Throws when `gh` fails, so that the caller does not exit 0 on a failed release.
 */
export function createGithubRelease(options: CreateGithubReleaseOptions): CreateReleaseResult {
  const { tag, changelogJsonPath, isDryRun, sectionOrder } = options;

  const loaded = loadChangelogEntries(changelogJsonPath);
  if (loaded.status === 'missing') {
    return { status: 'skipped', reason: 'missing-file' };
  }
  if (loaded.status === 'unreadable') {
    return { status: 'skipped', reason: 'unreadable-file' };
  }

  const version = extractVersion(tag);
  const entry = loaded.entries.find((e) => e.version === version);
  if (entry === undefined) {
    return { status: 'skipped', reason: 'no-entry' };
  }

  if (!entry.sections.some(matchesAudience('all'))) {
    return { status: 'skipped', reason: 'no-audience-content' };
  }

  const body = renderReleaseNotesSingle(entry, {
    filter: matchesAudience('all'),
    shouldIncludeHeading: false,
    ...(sectionOrder !== undefined && { sectionOrder }),
  });

  if (body.trim() === '') {
    return { status: 'skipped', reason: 'empty-body' };
  }

  const args = ['release', 'create', tag, '--title', tag, '--notes', body];

  if (isDryRun) {
    console.info(`[dry-run] Would run: gh ${args.join(' ')}`);
    return { status: 'created' };
  }

  try {
    execFileSync('gh', args, { stdio: 'inherit' });
  } catch (error: unknown) {
    throw asUserError(error);
  }
  return { status: 'created' };
}

/** Outcome of a `createGithubReleases` invocation. */
export interface CreateGithubReleasesOutcome {
  /** Tags for which a Release was created (or would be, under `--dry-run`). */
  createdTags: string[];
  /** Tags that were skipped, each with the reason and the `changelog.json` path that was read for it. */
  skippedTags: SkippedReleaseTag[];
}

/** A tag that `createGithubReleases` skipped. */
export interface SkippedReleaseTag {
  tag: string;
  reason: CreateReleaseSkipReason;
  changelogJsonPath: string;
}

/** Creates a GitHub Release for each tag and records each skip with its reason; throws at once when `gh` fails. */
export function createGithubReleases(
  tags: Array<{ tag: string; workspacePath: string }>,
  changelogJsonOutputPath: string,
  isDryRun: boolean,
  sectionOrder?: string[],
): CreateGithubReleasesOutcome {
  const createdTags: string[] = [];
  const skippedTags: SkippedReleaseTag[] = [];
  for (const { tag, workspacePath } of tags) {
    const changelogJsonPath = join(workspacePath, changelogJsonOutputPath);
    const result = createGithubRelease({
      tag,
      changelogJsonPath,
      isDryRun,
      ...(sectionOrder !== undefined && { sectionOrder }),
    });
    if (result.status === 'created') {
      createdTags.push(tag);
    } else {
      skippedTags.push({ tag, reason: result.reason, changelogJsonPath });
    }
  }
  return { createdTags, skippedTags };
}
