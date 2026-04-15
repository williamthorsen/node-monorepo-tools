import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { extractVersion, readChangelogEntries } from './changelogJsonUtils.ts';
import { matchesAudience, renderReleaseNotesSingle } from './renderReleaseNotes.ts';
import type { ReleaseNotesConfig } from './types.ts';

/** Options for creating a GitHub Release. */
export interface CreateGithubReleaseOptions {
  tag: string;
  changelogJsonPath: string;
  dryRun: boolean;
}

/**
 * Create a GitHub Release from changelog.json using the `gh` CLI.
 *
 * Reads the changelog JSON, finds the entry matching the tag's version, renders all-audience
 * release notes, and creates the release. Failures produce warnings rather than errors.
 */
export function createGithubRelease(options: CreateGithubReleaseOptions): boolean {
  const { tag, changelogJsonPath, dryRun } = options;

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
  });

  if (body.trim() === '') {
    return false;
  }

  const args = ['release', 'create', tag, '--title', tag, '--notes', body];

  if (dryRun) {
    console.info(`[dry-run] Would run: gh ${args.join(' ')}`);
    return true;
  }

  try {
    execFileSync('gh', args, { stdio: 'inherit' });
    return true;
  } catch (error: unknown) {
    console.warn(
      `Warning: failed to create GitHub Release for ${tag}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/**
 * Create GitHub Releases for all resolved tags.
 *
 * Called from the publish command when `shouldCreateGithubRelease` is enabled.
 */
export function createGithubReleases(
  tags: Array<{ tag: string; workspacePath: string }>,
  releaseNotes: ReleaseNotesConfig,
  changelogJsonOutputPath: string,
  dryRun: boolean,
): void {
  if (!releaseNotes.shouldCreateGithubRelease) {
    return;
  }

  for (const { tag, workspacePath } of tags) {
    const changelogJsonPath = join(workspacePath, changelogJsonOutputPath);
    createGithubRelease({ tag, changelogJsonPath, dryRun });
  }
}
