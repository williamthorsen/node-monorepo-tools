/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { basename } from 'node:path';

import { parseArgs, translateParseError } from '@williamthorsen/node-monorepo-core';

import { createGithubReleases } from './createGithubRelease.ts';
import { discoverWorkspaces } from './discoverWorkspaces.ts';
import { resolveReleaseNotesConfig } from './resolveReleaseNotesConfig.ts';
import type { ResolvedTag } from './resolveReleaseTags.ts';
import { resolveReleaseTags } from './resolveReleaseTags.ts';

const createGithubReleaseFlagSchema = {
  dryRun: { long: '--dry-run', type: 'boolean' as const },
  tags: { long: '--tags', type: 'string' as const },
};

/**
 * Orchestrate the CLI `create-github-release` command: create GitHub Releases from changelog.json
 * for tags on HEAD (or a comma-separated `--tags` subset), without requiring npm publish.
 */
export async function createGithubReleaseCommand(argv: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs(argv, createGithubReleaseFlagSchema);
  } catch (error: unknown) {
    console.error(`Error: ${translateParseError(error)}`);
    process.exit(1);
  }

  const { dryRun } = parsed.flags;
  const requestedTags = parseRequestedTags(parsed.flags.tags);

  const resolvedTags = await resolveTagsForRelease(requestedTags);

  const { changelogJsonOutputPath, sectionOrder } = await resolveReleaseNotesConfig({ strictLoad: true });

  let outcome;
  try {
    outcome = createGithubReleases(resolvedTags, changelogJsonOutputPath, dryRun, sectionOrder);
  } catch (error: unknown) {
    console.error(`Error creating GitHub Releases: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  // Fail visibly when the user explicitly requested tags via --tags and no Release was created.
  // A soft-skip across every requested tag is a silent-success gap for this command, whose whole
  // purpose is failure visibility. Omitted --tags (operate on all HEAD tags) keeps the legacy
  // soft-skip behavior since the user did not single out specific tags.
  if (requestedTags !== undefined && outcome.created.length === 0) {
    console.error(
      `Error: no GitHub Releases were created for requested tags: ${outcome.skipped.join(', ')}. ` +
        `Each was skipped (missing changelog entry, no all-audience content, or empty rendered body).`,
    );
    process.exit(1);
  }

  if (outcome.skipped.length > 0) {
    console.info(`Skipped ${outcome.skipped.length} tag(s) with no releasable content: ${outcome.skipped.join(', ')}.`);
  }
}

/**
 * Parse the comma-separated `--tags` flag value into a list of requested tag names.
 *
 * Empty segments (from `--tags=`, leading/trailing commas, or `--tags=,,`) are dropped. When the
 * resulting list is empty, returns `undefined` so the caller treats it as "no filter" — the same
 * behavior as omitting `--tags` entirely.
 */
function parseRequestedTags(flagValue: string | undefined): string[] | undefined {
  if (flagValue === undefined) {
    return undefined;
  }
  const segments = flagValue.split(',').filter(Boolean);
  return segments.length === 0 ? undefined : segments;
}

/**
 * Resolve the tag list for `create-github-release`.
 *
 * When `requestedTags` is provided, validate each entry against the tags on HEAD by full tag name
 * (e.g., `core-v1.3.0`) and return only the matched subset. Otherwise, return all tags on HEAD.
 * Exits with an error message on any validation failure.
 */
async function resolveTagsForRelease(requestedTags: string[] | undefined): Promise<ResolvedTag[]> {
  let discoveredPaths: string[] | undefined;
  try {
    discoveredPaths = await discoverWorkspaces();
  } catch (error: unknown) {
    console.error(`Error discovering workspaces: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const workspaceMap =
    discoveredPaths === undefined ? undefined : new Map(discoveredPaths.map((p) => [basename(p), p]));

  let resolvedTags = resolveReleaseTags(workspaceMap);

  if (resolvedTags.length === 0) {
    console.error('Error: No release tags found on HEAD. Create tags with `release-kit tag` first.');
    process.exit(1);
  }

  if (requestedTags !== undefined) {
    const availableTagNames = resolvedTags.map((t) => t.tag);
    for (const name of requestedTags) {
      if (!availableTagNames.includes(name)) {
        console.error(`Error: Unknown tag "${name}" in --tags. Available: ${availableTagNames.join(', ')}`);
        process.exit(1);
      }
    }
    resolvedTags = resolvedTags.filter((t) => requestedTags.includes(t.tag));
  }

  return resolvedTags;
}
