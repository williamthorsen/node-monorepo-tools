import { formatStatusLine, type StreamStyles } from '@williamthorsen/nmr-core';

import { describeChangelogFileProblem } from './changelogJsonUtils.ts';
import { createGithubReleases, type SkippedReleaseTag } from './createGithubRelease.ts';
import { deriveReleaseNotesConfig } from './deriveReleaseNotesConfig.ts';
import { formatPrivateSkip } from './formatPrivateSkip.ts';
import { loadUsableConfig } from './loadValidatedConfig.ts';
import { resolveCommandTags } from './resolveCommandTags.ts';
import type { ResolvedTag } from './resolveReleaseTags.ts';
import { prefixUserError } from './user-error-chaining.ts';
export interface CreateGithubReleaseCommandOptions {
  configPath: string | undefined;
  isDryRun: boolean;
  /** The tag names that `--tags` selects, or `undefined` for every release tag on HEAD. */
  tags: string[] | undefined;
  styles: StreamStyles;
}

/**
 * Runs the CLI `create-github-release` command: creates GitHub Releases from `changelog.json` for the tags on HEAD, or
 * a comma-separated `--tags` subset, without publishing to npm.
 *
 * A private workspace's tag is skipped with a warning and doesn't get a Release; an all-private tag set is a clean
 * no-op. A project tag gets a Release whatever the root `package.json#private` says.
 */
export async function createGithubReleaseCommand({
  configPath,
  isDryRun,
  tags,
  styles,
}: CreateGithubReleaseCommandOptions): Promise<void> {
  const userConfig = await loadUsableConfig(styles.stderr, configPath);

  const resolvedTags = resolveCommandTags(tags, userConfig);

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
    throw prefixUserError('Failed to create GitHub Releases', error);
  }

  const contentSkips: SkippedReleaseTag[] = [];
  for (const skippedTag of outcome.skippedTags) {
    const fileProblem = describeFileProblem(skippedTag);
    if (fileProblem === undefined) {
      contentSkips.push(skippedTag);
    } else {
      console.warn(
        `  ${formatStatusLine(styles.stderr, 'warning', `Skipping GitHub Release for ${skippedTag.tag}: ${fileProblem}`)}`,
      );
    }
  }

  // `resolveCommandTags` has already rejected an unknown tag, so a tag skipped here exists in git and doesn't have any
  // releasable content.
  if (contentSkips.length === 0) {
    return;
  }
  const formattedSkips = contentSkips.map((s) => `${s.tag} (${s.reason})`).join(', ');
  console.info(`Skipped ${contentSkips.length} tag(s) without releasable content: ${formattedSkips}.`);
}

// region | Helpers

/** Describes a skip caused by the `changelog.json` itself, or returns `undefined` for a skip caused by its content. */
function describeFileProblem(skippedTag: SkippedReleaseTag): string | undefined {
  switch (skippedTag.reason) {
    case 'missing-file':
      return describeChangelogFileProblem('missing', skippedTag.changelogJsonPath);
    case 'unreadable-file':
      return describeChangelogFileProblem('unreadable', skippedTag.changelogJsonPath);
    default:
      return undefined;
  }
}

/**
 * Reports whether the tag gets a GitHub Release: a directory or project tag always does, and a package tag when it is
 * public.
 */
function isReleasable(resolvedTag: ResolvedTag): boolean {
  return resolvedTag.kind !== 'package' || resolvedTag.isPublishable;
}

// endregion | Helpers
