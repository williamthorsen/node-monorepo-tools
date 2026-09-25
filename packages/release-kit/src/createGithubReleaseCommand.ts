/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { parseArgsOrExit, reportError, type StreamStyles } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { configFlagSchema } from './configFlagSchema.ts';
import { createGithubReleases } from './createGithubRelease.ts';
import { resolveReleaseNotesConfig } from './deriveReleaseNotesConfig.ts';
import { formatPrivateSkip } from './formatPrivateSkip.ts';
import { assertConfigUsable } from './loadValidatedConfig.ts';
import { parseRequestedTags } from './parseRequestedTags.ts';
import { resolveCommandTags } from './resolveCommandTags.ts';
import { resolveConfigFlag } from './resolveConfigFlag.ts';

const createGithubReleaseFlagSchema = {
  ...configFlagSchema,
  dryRun: { long: '--dry-run', type: 'boolean' as const },
  tags: { long: '--tags', type: 'string' as const },
};

/**
 * Orchestrate the CLI `create-github-release` command: Create GitHub Releases from changelog.json
 * for tags on HEAD (or a comma-separated `--tags` subset), without requiring npm publish.
 *
 * Private/unpublishable workspaces are skipped with a warning and never get a Release, matching
 * `release-kit publish`; an all-private tag set is a clean no-op. A relative `--config` resolves against
 * `invocationDir`.
 */
export async function createGithubReleaseCommand(
  argv: string[],
  styles: StreamStyles,
  invocationDir: string,
): Promise<void> {
  const parsed = parseArgsOrExit(argv, createGithubReleaseFlagSchema);
  const configPath = resolveConfigFlag(parsed.flags.config, invocationDir);

  const { dryRun } = parsed.flags;

  // An all-private tag set returns below without reading a config, so the config is opened and validated first.
  await assertConfigUsable(styles.stderr, configPath);

  const requestedTags = parseRequestedTags(parsed.flags.tags);

  const resolvedTags = resolveCommandTags(requestedTags, undefined);

  // Skip unpublishable (private) workspaces cleanly: A private package is versioned and tagged but must not get a
  // GitHub Release. Warn per skipped tag, matching `release-kit publish`. Then short-circuit before loading
  // release-notes config when nothing publishable remains, so that an all-private repo is a clean no-op that does not
  // depend on release-notes config being present.
  const publishableTags = resolvedTags.filter((resolvedTag) => resolvedTag.isPublishable);
  for (const resolvedTag of resolvedTags) {
    if (!resolvedTag.isPublishable) {
      console.warn(formatPrivateSkip(resolvedTag));
    }
  }

  if (publishableTags.length === 0) {
    return;
  }

  const { changelogJsonOutputPath, sectionOrder } = await resolveReleaseNotesConfig(styles.stderr, {
    ...(configPath !== undefined && { configPath }),
  });

  let outcome;
  try {
    outcome = createGithubReleases(publishableTags, changelogJsonOutputPath, dryRun, sectionOrder);
  } catch (error: unknown) {
    reportError(`Failed to create GitHub Releases: ${describeError(error)}`);
    process.exit(1);
  }

  // Treat every per-tag skip reason (`no-entry`, `no-audience-content`, `empty-body`) as informational.
  // Typo protection for `--tags` lives upstream in `resolveCommandTags`, which exits 1 with `Error: Unknown tag "..."`
  // before any tag reaches `createGithubReleases`. By the time a tag's outcome is `no-entry` here, its existence in git
  // is guaranteed and the missing entry is a legitimate "no releasable content" outcome (same as the other reasons).
  if (outcome.skipped.length > 0) {
    const formatted = outcome.skipped.map((s) => `${s.tag} (${s.reason})`).join(', ');
    console.info(`Skipped ${outcome.skipped.length} tag(s) with no releasable content: ${formatted}.`);
  }
}
