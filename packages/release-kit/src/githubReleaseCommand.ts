/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { basename } from 'node:path';

import { parseArgs, translateParseError } from '@williamthorsen/node-monorepo-core';

import { createGithubReleases } from './createGithubRelease.ts';
import { discoverWorkspaces } from './discoverWorkspaces.ts';
import { resolveReleaseNotesConfig } from './publishCommand.ts';
import { resolveReleaseTags } from './resolveReleaseTags.ts';

const githubReleaseFlagSchema = {
  dryRun: { long: '--dry-run', type: 'boolean' as const },
  only: { long: '--only', type: 'string' as const },
};

/**
 * Orchestrate the CLI `github-release` command: create GitHub Releases from changelog.json
 * for tags on HEAD, without requiring npm publish.
 */
export async function githubReleaseCommand(argv: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs(argv, githubReleaseFlagSchema);
  } catch (error: unknown) {
    console.error(`Error: ${translateParseError(error)}`);
    process.exit(1);
  }

  const { dryRun } = parsed.flags;
  const only = parsed.flags.only?.split(',');

  // Discover workspaces to determine single-package vs monorepo mode.
  let discoveredPaths: string[] | undefined;
  try {
    discoveredPaths = await discoverWorkspaces();
  } catch (error: unknown) {
    console.error(`Error discovering workspaces: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  if (only !== undefined && discoveredPaths === undefined) {
    console.error('Error: --only is only supported for monorepo configurations');
    process.exit(1);
  }

  // Build workspace map: dir (basename) -> workspace path.
  const workspaceMap =
    discoveredPaths === undefined ? undefined : new Map(discoveredPaths.map((p) => [basename(p), p]));

  // Resolve tags from HEAD.
  let resolvedTags = resolveReleaseTags(workspaceMap);

  if (resolvedTags.length === 0) {
    console.error('Error: No release tags found on HEAD. Create tags with `release-kit tag` first.');
    process.exit(1);
  }

  // Validate --only against resolved tags.
  if (only !== undefined) {
    const availableNames = resolvedTags.map((t) => t.dir);
    for (const name of only) {
      if (!availableNames.includes(name)) {
        console.error(`Error: Unknown package "${name}" in --only. Available: ${availableNames.join(', ')}`);
        process.exit(1);
      }
    }
    resolvedTags = resolvedTags.filter((t) => only.includes(t.dir));
  }

  const { releaseNotes, changelogJsonOutputPath } = await resolveReleaseNotesConfig();

  // Force GitHub Release creation regardless of config setting — this command's sole purpose.
  createGithubReleases(
    resolvedTags,
    { ...releaseNotes, shouldCreateGithubRelease: true },
    changelogJsonOutputPath,
    dryRun,
  );
}
