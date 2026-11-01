/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseArgsOrExit, reportError, type StreamStyles } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { assertCleanWorkingTree } from './assertCleanWorkingTree.ts';
import { assertTarballsComplete } from './assertTarballsComplete.ts';
import { configFlagSchema } from './configFlagSchema.ts';
import { deriveReleaseNotesConfig } from './deriveReleaseNotesConfig.ts';
import { detectPackageManager } from './detectPackageManager.ts';
import { formatDirectoryPublishSkip } from './formatDirectoryPublishSkip.ts';
import { formatPrivateSkip } from './formatPrivateSkip.ts';
import { formatProjectPublishSkip } from './formatProjectPublishSkip.ts';
import { injectReleaseNotesIntoReadme, resolveReadmePath } from './injectReleaseNotesIntoReadme.ts';
import { loadUsableConfig } from './loadValidatedConfig.ts';
import { parseRequestedTags } from './parseRequestedTags.ts';
import { publishPackage } from './publish.ts';
import { resolveCommandTags } from './resolveCommandTags.ts';
import { resolveConfigFlag } from './resolveConfigFlag.ts';
import type { ResolvedTag } from './resolveReleaseTags.ts';

const publishFlagSchema = {
  ...configFlagSchema,
  isDryRun: { long: '--dry-run', type: 'boolean' as const },
  shouldSkipGitChecks: { long: '--no-git-checks', type: 'boolean' as const },
  shouldGenerateProvenance: { long: '--provenance', type: 'boolean' as const },
  tags: { long: '--tags', type: 'string' as const },
};

/**
 * Orchestrates the CLI `publish` command: checks for a clean working tree, resolves the tags on HEAD, checks the
 * tarballs of the publishable ones from a clean checkout, and publishes each one, injecting release notes into its
 * README for the duration of the publish. A relative `--config` resolves against `invocationDir`.
 */
export async function publishCommand(argv: string[], styles: StreamStyles, invocationDir: string): Promise<void> {
  const parsedArgs = parseArgsOrExit(argv, publishFlagSchema);
  const configPath = resolveConfigFlag(parsedArgs.flags.config, invocationDir);

  const { isDryRun, shouldSkipGitChecks, shouldGenerateProvenance } = parsedArgs.flags;

  const userConfig = await loadUsableConfig(styles.stderr, configPath);

  // Run release-kit's own clean-tree check: `publishPackage` bypasses pnpm's, which would fail on the injected README.
  if (!isDryRun && !shouldSkipGitChecks) {
    try {
      assertCleanWorkingTree();
    } catch (error: unknown) {
      reportError(describeError(error));
      process.exit(1);
    }
  }

  const requestedTags = parseRequestedTags(parsedArgs.flags.tags);

  const resolvedTags = resolveCommandTags(requestedTags, userConfig);

  if (resolvedTags.length === 0) {
    return;
  }

  const publishableTags = filterPublishableTags(resolvedTags, requestedTags !== undefined);

  if (publishableTags.length === 0) {
    console.info('Nothing to publish.');
    return;
  }

  try {
    assertTarballsComplete(
      publishableTags.map(({ workspacePath }) => workspacePath),
      userConfig?.devExportConditions ?? [],
    );
  } catch (error: unknown) {
    reportError(describeError(error));
    process.exit(1);
  }

  const packageManager = detectPackageManager();
  const { releaseNotes, changelogJsonOutputPath, sectionOrder } = deriveReleaseNotesConfig(userConfig);

  const shouldInject = releaseNotes.shouldInjectIntoReadme;

  console.info(isDryRun ? '[dry-run] Would publish:' : 'Publishing:');
  for (const { tag, workspacePath } of publishableTags) {
    console.info(`  ${tag} (${workspacePath})`);
  }

  const publishedTags: string[] = [];

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
        publishPackage(resolvedTag, packageManager, { isDryRun, shouldGenerateProvenance });
        publishedTags.push(resolvedTag.tag);
      } finally {
        if (readmePath !== undefined && originalReadme !== undefined) {
          writeFileSync(readmePath, originalReadme, 'utf8');
        }
      }
    }
  } catch (error: unknown) {
    if (publishedTags.length > 0) {
      console.warn('Packages published before failure:');
      for (const tag of publishedTags) {
        console.warn(`  ${tag}`);
      }
    }
    reportError(describeError(error));
    process.exit(1);
  }
}

/**
 * Restricts the resolved tag set to publishable workspaces, which excludes every directory and project tag.
 *
 * When the user named tags explicitly via `--tags` (`isExplicit === true`), each unpublishable
 * tag is skipped with a warning and the publishable tags still publish. When resolution was
 * implicit, unpublishable tags are dropped silently.
 */
function filterPublishableTags(resolvedTags: ResolvedTag[], isExplicit: boolean): ResolvedTag[] {
  const publishableTags: ResolvedTag[] = [];
  const unpublishableTags: ResolvedTag[] = [];
  for (const tag of resolvedTags) {
    (tag.isPublishable ? publishableTags : unpublishableTags).push(tag);
  }

  // Warn only on explicit naming: An implicit HEAD scan routinely finds private-but-tagged workspaces, whereas
  // naming a tag signals that the user expected it to publish.
  if (isExplicit) {
    for (const resolvedTag of unpublishableTags) {
      console.warn(formatPublishSkip(resolvedTag));
    }
  }

  return publishableTags;
}

/** Formats the warning for a tag that `publish` skips, by what owns the tag. */
function formatPublishSkip(resolvedTag: ResolvedTag): string {
  switch (resolvedTag.kind) {
    case 'directory':
      return formatDirectoryPublishSkip(resolvedTag);
    case 'project':
      return formatProjectPublishSkip(resolvedTag);
    case 'package':
      return formatPrivateSkip(resolvedTag);
  }
}
