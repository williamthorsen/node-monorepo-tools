/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseArgs, translateParseError } from '@williamthorsen/nmr-core';

import { assertCleanWorkingTree } from './assertCleanWorkingTree.ts';
import { detectPackageManager } from './detectPackageManager.ts';
import { injectReleaseNotesIntoReadme, resolveReadmePath } from './injectReleaseNotesIntoReadme.ts';
import { parseRequestedTags } from './parseRequestedTags.ts';
import { publishPackage } from './publish.ts';
import { resolveCommandTags } from './resolveCommandTags.ts';
import { resolveReleaseNotesConfig } from './resolveReleaseNotesConfig.ts';
import type { ResolvedTag } from './resolveReleaseTags.ts';

const publishFlagSchema = {
  dryRun: { long: '--dry-run', type: 'boolean' as const },
  noGitChecks: { long: '--no-git-checks', type: 'boolean' as const },
  provenance: { long: '--provenance', type: 'boolean' as const },
  tags: { long: '--tags', type: 'string' as const },
};

/**
 * Orchestrate the CLI `publish` command: parse flags, discover workspaces, resolve tags from HEAD,
 * detect the package manager, validate `--tags`, and publish each tag with inject/restore lifecycle.
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

  // Guard against running on a dirty working tree (skip for dry runs and --no-git-checks).
  // Mirrors prepareCommand and tagCommand: release-kit owns the check; pnpm's own check is
  // bypassed downstream because release-kit deliberately mutates the README during publish.
  if (!dryRun && !noGitChecks) {
    try {
      assertCleanWorkingTree();
    } catch (error: unknown) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  const requestedTags = parseRequestedTags(parsed.flags.tags);

  const resolvedTags = await resolveCommandTags(requestedTags);

  if (resolvedTags.length === 0) {
    return;
  }

  const publishableTags = filterPublishableTags(resolvedTags, requestedTags !== undefined);

  if (publishableTags.length === 0) {
    console.info('Nothing to publish.');
    return;
  }

  const packageManager = detectPackageManager();
  const { releaseNotes, changelogJsonOutputPath, sectionOrder } = await resolveReleaseNotesConfig();

  const shouldInject = releaseNotes.shouldInjectIntoReadme;

  // Print confirmation listing before publishing.
  console.info(dryRun ? '[dry-run] Would publish:' : 'Publishing:');
  for (const { tag, workspacePath } of publishableTags) {
    console.info(`  ${tag} (${workspacePath})`);
  }

  const published: string[] = [];

  try {
    for (const resolvedTag of publishableTags) {
      let readmePath: string | undefined;
      let originalReadme: string | undefined;

      if (shouldInject) {
        readmePath = resolveReadmePath(resolvedTag.workspacePath);
        if (readmePath !== undefined) {
          originalReadme = injectReleaseNotesIntoReadme(
            readmePath,
            join(resolvedTag.workspacePath, changelogJsonOutputPath),
            resolvedTag.tag,
            sectionOrder,
          );
        }
      }

      try {
        publishPackage(resolvedTag, packageManager, { dryRun, provenance });
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
}

/**
 * Restrict the resolved tag set to publishable workspaces.
 *
 * When the user named tags explicitly via `--tags` (`isExplicit === true`), an unpublishable
 * tag is an error: each unpublishable tag is reported and the process exits 1. When
 * resolution was implicit, unpublishable tags are silently dropped. The caller handles the
 * empty-result case (printing `Nothing to publish.` and returning).
 */
function filterPublishableTags(resolvedTags: ResolvedTag[], isExplicit: boolean): ResolvedTag[] {
  const publishable: ResolvedTag[] = [];
  const unpublishable: ResolvedTag[] = [];
  for (const tag of resolvedTags) {
    (tag.isPublishable ? publishable : unpublishable).push(tag);
  }

  if (isExplicit && unpublishable.length > 0) {
    for (const { tag, workspacePath } of unpublishable) {
      console.error(`Error: ${tag} (${workspacePath}) cannot be published: package.json#private is true.`);
    }
    process.exit(1);
  }

  return publishable;
}
