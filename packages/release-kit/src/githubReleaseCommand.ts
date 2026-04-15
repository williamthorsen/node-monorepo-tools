/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { parseArgs, translateParseError } from '@williamthorsen/node-monorepo-core';

import { createGithubReleases } from './createGithubRelease.ts';
import { resolveCommandTags } from './resolveCommandTags.ts';
import { resolveReleaseNotesConfig } from './resolveReleaseNotesConfig.ts';

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

  const resolvedTags = await resolveCommandTags(only);

  const { releaseNotes, changelogJsonOutputPath } = await resolveReleaseNotesConfig();

  // Force GitHub Release creation regardless of config setting — this command's sole purpose.
  try {
    createGithubReleases(
      resolvedTags,
      { ...releaseNotes, shouldCreateGithubRelease: true },
      changelogJsonOutputPath,
      dryRun,
    );
  } catch (error: unknown) {
    console.error(`Error creating GitHub Releases: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
