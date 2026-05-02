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
 * Discriminated reason a single tag was skipped.
 *
 * `'no-entry'` is the umbrella for all "data missing" sub-cases (changelog file not found,
 * JSON unparseable, version not in changelog) — distinguishing them programmatically adds no
 * value to the consumer, while the existing `console.warn` messages already discriminate them
 * for human diagnostics.
 */
export type CreateReleaseSkipReason = 'no-entry' | 'no-audience-content' | 'empty-body';

/** Discriminated outcome of attempting to create a single GitHub Release. */
export type CreateReleaseResult = { status: 'created' } | { status: 'skipped'; reason: CreateReleaseSkipReason };

/**
 * Create a GitHub Release from changelog.json using the `gh` CLI.
 *
 * Reads the changelog JSON, finds the entry matching the tag's version, renders all-audience
 * release notes, and creates the release. Returns a discriminated `{status: 'skipped', reason}`
 * (with a warning) when the changelog entry is missing, the entry has no all-audience content,
 * or the rendered body is empty. Throws when the `gh` CLI invocation itself fails so callers
 * can surface the failure rather than exit 0 silently.
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
    ...(sectionOrder === undefined ? {} : { sectionOrder }),
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

/**
 * Create GitHub Releases for each provided tag.
 *
 * Per-tag soft-fails (missing changelog entry, no all-audience content, empty rendered body) are
 * recorded in `skipped` with their discriminated reason and do not throw. Hard failures from the
 * `gh` CLI itself throw and short-circuit the loop so callers can surface them.
 */
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
      ...(sectionOrder === undefined ? {} : { sectionOrder }),
    });
    if (result.status === 'created') {
      created.push(tag);
    } else {
      skipped.push({ tag, reason: result.reason });
    }
  }
  return { created, skipped };
}
