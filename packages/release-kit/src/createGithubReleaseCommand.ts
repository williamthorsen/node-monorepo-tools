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

const createGithubReleaseFlagSchema = {
  ...configFlagSchema,
  dryRun: { long: '--dry-run', type: 'boolean' as const },
  tags: { long: '--tags', type: 'string' as const },
};

/**
 * Runs the CLI `create-github-release` command: creates GitHub Releases from `changelog.json` for the tags on HEAD, or
 * a comma-separated `--tags` subset, without publishing to npm.
 *
 * A private workspace's tag is skipped with a warning and gets no Release; an all-private tag set is a clean no-op. A
 * relative `--config` resolves against `invocationDir`.
 */
export async function createGithubReleaseCommand(
  argv: string[],
  styles: StreamStyles,
  invocationDir: string,
): Promise<void> {
  const parsed = parseArgsOrExit(argv, createGithubReleaseFlagSchema);
  const configPath = resolveConfigFlag(parsed.flags.config, invocationDir);

  const { dryRun } = parsed.flags;

  const userConfig = await loadUsableConfig(styles.stderr, configPath);

  const requestedTags = parseRequestedTags(parsed.flags.tags);

  const resolvedTags = resolveCommandTags(requestedTags, userConfig);

  // A private package is versioned and tagged but gets no GitHub Release.
  const publishableTags = resolvedTags.filter((resolvedTag) => resolvedTag.isPublishable);
  for (const resolvedTag of resolvedTags) {
    if (!resolvedTag.isPublishable) {
      console.warn(formatPrivateSkip(resolvedTag));
    }
  }

  if (publishableTags.length === 0) {
    return;
  }

  const { changelogJsonOutputPath, sectionOrder } = deriveReleaseNotesConfig(userConfig);

  let outcome;
  try {
    outcome = createGithubReleases(publishableTags, changelogJsonOutputPath, dryRun, sectionOrder);
  } catch (error: unknown) {
    reportError(`Failed to create GitHub Releases: ${describeError(error)}`);
    process.exit(1);
  }

  // Treat every skip as informational: `resolveCommandTags` has already rejected an unknown tag, so a `no-entry` tag
  // exists in git and has no releasable content.
  if (outcome.skipped.length > 0) {
    const formatted = outcome.skipped.map((s) => `${s.tag} (${s.reason})`).join(', ');
    console.info(`Skipped ${outcome.skipped.length} tag(s) with no releasable content: ${formatted}.`);
  }
}
