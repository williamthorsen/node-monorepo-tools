import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { matchesAudience, renderReleaseNotesSingle } from './renderReleaseNotes.ts';
import { isRecord, isUnknownArray } from './typeGuards.ts';
import type { ChangelogEntry, ReleaseNotesConfig } from './types.ts';

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
  const entries = readChangelogJson(changelogJsonPath);

  if (entries === undefined) {
    console.warn(`Warning: could not parse ${changelogJsonPath}; skipping GitHub Release creation`);
    return false;
  }

  const entry = entries.find((e) => e.version === version);
  if (entry === undefined) {
    console.warn(`Warning: no changelog entry for version ${version}; skipping GitHub Release creation`);
    return false;
  }

  const body = renderReleaseNotesSingle(entry, {
    filter: matchesAudience('all'),
    includeHeading: false,
  });

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

/** Extract the version from a tag by stripping the prefix up to the first digit. */
function extractVersion(tag: string): string {
  const match = /(\d+\.\d+\.\d+.*)$/.exec(tag);
  return match?.[1] ?? tag;
}

/** Read and parse a changelog JSON file. */
function readChangelogJson(filePath: string): ChangelogEntry[] | undefined {
  try {
    const content = readFileSync(filePath, 'utf8');
    const parsed: unknown = JSON.parse(content);
    if (!isUnknownArray(parsed)) {
      return undefined;
    }
    return parsed.filter(isChangelogEntry);
  } catch {
    return undefined;
  }
}

/** Type guard for `ChangelogEntry` values parsed from JSON. */
function isChangelogEntry(value: unknown): value is ChangelogEntry {
  return (
    isRecord(value) &&
    typeof value.version === 'string' &&
    typeof value.date === 'string' &&
    isUnknownArray(value.sections)
  );
}
