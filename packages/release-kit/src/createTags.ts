import { execFileSync } from 'node:child_process';

import { formatGlyphLine, GIT_OUTPUT_LIMIT_BYTES, hasErrnoCode, type OutputStyle } from '@williamthorsen/nmr-core';

import { deleteFileIfExists } from './deleteFileIfExists.ts';
import { RELEASE_GLYPHS } from './glyphs.ts';
import { readReleaseTags, RELEASE_SUMMARY_FILE, RELEASE_TAGS_FILE } from './releaseFiles.ts';

export interface CreateTagsOptions {
  isDryRun: boolean;
  shouldSkipGitChecks: boolean;
  style: OutputStyle;
}

/**
 * Creates an annotated git tag for each name in the tags file written by `prepare`, then deletes the tags and summary
 * files, and returns the tag names. In dry-run mode, it only lists the names.
 */
export function createTags(options: CreateTagsOptions): string[] {
  const { isDryRun, shouldSkipGitChecks, style } = options;

  const tags = readReleaseTags();

  if (tags.length === 0) {
    return [];
  }

  if (!isDryRun && !shouldSkipGitChecks) {
    assertCleanWorkingTree();
  }

  if (isDryRun) {
    console.info('[dry-run] Would create tags:');
    for (const tag of tags) {
      console.info(formatGlyphLine(RELEASE_GLYPHS, style, 'tag', tag));
    }
    return tags;
  }

  const created: string[] = [];
  for (const tag of tags) {
    try {
      execFileSync('git', ['tag', '-a', tag, '-m', tag], { maxBuffer: GIT_OUTPUT_LIMIT_BYTES });
      created.push(tag);
    } catch (error: unknown) {
      if (created.length > 0) {
        console.warn('Tags created before failure:');
        for (const t of created) {
          console.warn(`  ${t}`);
        }
      }
      throw error;
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
function assertCleanWorkingTree(): void {
  try {
    execFileSync('git', ['diff', '--quiet'], { maxBuffer: GIT_OUTPUT_LIMIT_BYTES });
    execFileSync('git', ['diff', '--quiet', '--cached'], { maxBuffer: GIT_OUTPUT_LIMIT_BYTES });
  } catch (error: unknown) {
    if (hasErrnoCode(error, 'ENOENT')) {
      throw error;
    }
    throw new Error(
      'Working tree is dirty. Commit or stash changes before tagging, or use `--no-git-checks` to skip this check.',
      { cause: error },
    );
  }
}
