/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { parseArgs, translateParseError } from '@williamthorsen/node-monorepo-core';

import { createGithubReleases } from './createGithubRelease.ts';
import { detectPackageManager } from './detectPackageManager.ts';
import { discoverWorkspaces } from './discoverWorkspaces.ts';
import { injectReleaseNotesIntoReadme, resolveReadmePath } from './injectReleaseNotesIntoReadme.ts';
import { publishPackage } from './publish.ts';
import { resolveReleaseNotesConfig } from './resolveReleaseNotesConfig.ts';
import { resolveReleaseTags } from './resolveReleaseTags.ts';

const publishFlagSchema = {
  dryRun: { long: '--dry-run', type: 'boolean' as const },
  noGitChecks: { long: '--no-git-checks', type: 'boolean' as const },
  provenance: { long: '--provenance', type: 'boolean' as const },
  only: { long: '--only', type: 'string' as const },
};

/**
 * Orchestrate the CLI `publish` command: parse flags, discover workspaces, resolve tags from HEAD,
 * detect the package manager, validate `--only`, and publish each tag with inject/restore lifecycle.
 */
export async function publishCommand(argv: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs(argv, publishFlagSchema);
  } catch (error: unknown) {
    console.error(`Error: ${translateParseError(error)}`);
    process.exit(1);
  }

  const { dryRun, noGitChecks, provenance } = parsed.flags;
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

  if (resolvedTags.length === 0) {
    return;
  }

  const packageManager = detectPackageManager();
  const { releaseNotes, changelogJsonOutputPath } = await resolveReleaseNotesConfig();

  const shouldInject = releaseNotes.shouldInjectIntoReadme === true;

  // Print confirmation listing before publishing.
  console.info(dryRun ? '[dry-run] Would publish:' : 'Publishing:');
  for (const { tag, workspacePath } of resolvedTags) {
    console.info(`  ${tag} (${workspacePath})`);
  }

  const published: string[] = [];

  try {
    for (const resolvedTag of resolvedTags) {
      let readmePath: string | undefined;
      let originalReadme: string | undefined;

      if (shouldInject) {
        readmePath = resolveReadmePath(resolvedTag.workspacePath);
        if (readmePath !== undefined) {
          originalReadme = injectReleaseNotesIntoReadme(
            readmePath,
            join(resolvedTag.workspacePath, changelogJsonOutputPath),
            resolvedTag.tag,
          );
        }
      }

      try {
        publishPackage(resolvedTag, packageManager, { dryRun, noGitChecks, provenance });
        published.push(resolvedTag.tag);
      } finally {
        if (readmePath !== undefined && originalReadme !== undefined) {
          writeFileSync(readmePath, originalReadme, 'utf8');
        }
      }
    }
  } catch (error: unknown) {
    if (published.length > 0) {
      console.warn('Packages published before failure:');
      for (const t of published) {
        console.warn(`  ${t}`);
      }
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Create GitHub Releases after successful publish.
  try {
    createGithubReleases(resolvedTags, releaseNotes, changelogJsonOutputPath, dryRun);
  } catch (error: unknown) {
    console.error(`Error creating GitHub Releases: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
