/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { parseArgs, translateParseError } from '@williamthorsen/nmr-core';

import { createGithubReleases } from './createGithubRelease.ts';
import { parseRequestedTags } from './parseRequestedTags.ts';
import { resolveCommandTags } from './resolveCommandTags.ts';
import { resolveReleaseNotesConfig } from './resolveReleaseNotesConfig.ts';

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

  const resolvedTags = await resolveCommandTags(requestedTags);

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
