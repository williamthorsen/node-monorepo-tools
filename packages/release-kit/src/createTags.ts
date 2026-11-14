import { formatGlyphLine, type OutputStyle, UserError } from '@williamthorsen/nmr-core';

import { deleteFileIfExists } from './deleteFileIfExists.ts';
import { type Git, realGit } from './git.ts';
import { RELEASE_GLYPHS } from './glyphs.ts';
import { readReleaseTags, RELEASE_SUMMARY_FILE, RELEASE_TAGS_FILE } from './releaseFiles.ts';
import { asUserError } from './user-error-chaining.ts';

export interface CreateTagsOptions {
  isDryRun: boolean;
  shouldSkipGitChecks: boolean;
  style: OutputStyle;
}

/**
 * Creates an annotated git tag for each name in the tags file written by `prepare`, then deletes the tags and summary
 * files, and returns the tag names. In dry-run mode, it only lists the names.
 */
export function createTags(options: CreateTagsOptions, git: Git = realGit): string[] {
  const { isDryRun, shouldSkipGitChecks, style } = options;

  const tags = readReleaseTags();

  if (tags.length === 0) {
    return [];
  }

  if (!isDryRun && !shouldSkipGitChecks) {
    assertCleanWorkingTree(git);
  }

  if (isDryRun) {
    console.info('[dry-run] Would create tags:');
    for (const tag of tags) {
      console.info(formatGlyphLine(RELEASE_GLYPHS, style, 'tag', tag));
    }
    return tags;
  }

  const createdTags: string[] = [];
  for (const tag of tags) {
    try {
      git.createAnnotatedTag(tag);
      createdTags.push(tag);
    } catch (error: unknown) {
      const failure = asUserError(error);
      if (createdTags.length > 0) {
        console.warn('Tags created before failure:');
        for (const tag of createdTags) {
          console.warn(`  ${tag}`);
        }
      }
      throw failure;
    }
  }

  console.info('Created tags:');
  for (const tag of tags) {
    console.info(formatGlyphLine(RELEASE_GLYPHS, style, 'tag', tag));
  }

  deleteFileIfExists(RELEASE_TAGS_FILE);
  deleteFileIfExists(RELEASE_SUMMARY_FILE);

  return tags;
}

/** Throws if a tracked file has staged or unstaged changes. */
function assertCleanWorkingTree(git: Git): void {
  let isDirty: boolean;
  try {
    isDirty = git.hasTrackedChanges();
  } catch (error: unknown) {
    throw asUserError(error);
  }
  if (isDirty) {
    throw new UserError(
      'Working tree is dirty. Commit or stash changes before tagging, or use `--no-git-checks` to skip this check.',
    );
  }
}
