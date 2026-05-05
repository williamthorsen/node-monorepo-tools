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

  // Treat every per-tag skip reason (`no-entry`, `no-audience-content`, `empty-body`) as
  // informational. Typo protection for `--tags` lives upstream in `resolveCommandTags`, which
  // exits 1 with `Error: Unknown tag "..."` before any tag reaches `createGithubReleases`.
  // By the time a tag's outcome is `no-entry` here, its existence in git is guaranteed and the
  // missing entry is a legitimate "no releasable content" outcome — same as the other reasons.
  if (outcome.skipped.length > 0) {
    const formatted = outcome.skipped.map((s) => `${s.tag} (${s.reason})`).join(', ');
    console.info(`Skipped ${outcome.skipped.length} tag(s) with no releasable content: ${formatted}.`);
  }
}
