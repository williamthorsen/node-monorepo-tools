/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { parseArgsOrExit, reportError, type StreamStyles } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { configFlagSchema } from './configFlagSchema.ts';
import { createGithubReleases } from './createGithubRelease.ts';
import { deriveReleaseNotesConfig } from './deriveReleaseNotesConfig.ts';
import { formatPrivateSkip } from './formatPrivateSkip.ts';
import { loadUsableConfig } from './loadValidatedConfig.ts';
import { parseRequestedTags } from './parseRequestedTags.ts';
import { resolveCommandTags } from './resolveCommandTags.ts';
import { resolveConfigFlag } from './resolveConfigFlag.ts';
import type { ResolvedTag } from './resolveReleaseTags.ts';

const createGithubReleaseFlagSchema = {
  ...configFlagSchema,
  isDryRun: { long: '--dry-run', type: 'boolean' as const },
  tags: { long: '--tags', type: 'string' as const },
};

/**
 * Runs the CLI `create-github-release` command: creates GitHub Releases from `changelog.json` for the tags on HEAD, or
 * a comma-separated `--tags` subset, without publishing to npm.
 *
 * A private workspace's tag is skipped with a warning and doesn't get a Release; an all-private tag set is a clean
 * no-op. A project tag gets a Release whatever the root `package.json#private` says. A relative `--config` resolves
 * against `invocationDir`.
 */
export async function createGithubReleaseCommand(
  argv: string[],
  styles: StreamStyles,
  invocationDir: string,
): Promise<void> {
  const parsed = parseArgsOrExit(argv, createGithubReleaseFlagSchema);
  const configPath = resolveConfigFlag(parsed.flags.config, invocationDir);

  const { isDryRun } = parsed.flags;

  const userConfig = await loadUsableConfig(styles.stderr, configPath);

  const requestedTags = parseRequestedTags(parsed.flags.tags);

  const resolvedTags = resolveCommandTags(requestedTags, userConfig);

  // A private package is versioned and tagged but doesn't get a GitHub Release.
  const releasableTags = resolvedTags.filter(isReleasable);
  for (const resolvedTag of resolvedTags) {
    if (!isReleasable(resolvedTag)) {
      console.warn(formatPrivateSkip(resolvedTag));
    }
  }

  if (releasableTags.length === 0) {
    return;
  }

  const { changelogJsonOutputPath, sectionOrder } = deriveReleaseNotesConfig(userConfig);

  let outcome;
  try {
    outcome = createGithubReleases(releasableTags, changelogJsonOutputPath, isDryRun, sectionOrder);
  } catch (error: unknown) {
    reportError(`Failed to create GitHub Releases: ${describeError(error)}`);
    process.exit(1);
  }

  // Treat every skip as informational: `resolveCommandTags` has already rejected an unknown tag, so a `no-entry` tag
  // exists in git and doesn't have any releasable content.
  if (outcome.skipped.length === 0) {
    return;
  }
  const formatted = outcome.skipped.map((s) => `${s.tag} (${s.reason})`).join(', ');
  console.info(`Skipped ${outcome.skipped.length} tag(s) without releasable content: ${formatted}.`);
}

// region | Helpers

/**
 * Reports whether the tag gets a GitHub Release: a directory or project tag always does, and a package tag when it is
 * public.
 */
function isReleasable(resolvedTag: ResolvedTag): boolean {
  return resolvedTag.kind !== 'package' || resolvedTag.isPublishable;
}

// endregion | Helpers
