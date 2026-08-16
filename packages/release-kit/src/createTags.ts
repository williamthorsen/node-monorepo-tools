import { execFileSync } from 'node:child_process';

import { GIT_OUTPUT_LIMIT, hasErrnoCode } from '@williamthorsen/nmr-core';

import { deleteFileIfExists } from './deleteFileIfExists.ts';
import { readReleaseTags, RELEASE_SUMMARY_FILE, RELEASE_TAGS_FILE } from './releaseFiles.ts';

export interface CreateTagsOptions {
  dryRun: boolean;
  noGitChecks: boolean;
}

/**
 * Read tag names from the tags file produced by `prepare` and create annotated git tags.
 *
 * Returns the list of tag names that were created (or would be created in dry-run mode).
 */
export function createTags(options: CreateTagsOptions): string[] {
  const { dryRun, noGitChecks } = options;

  const tags = readReleaseTags();

  if (tags.length === 0) {
    return [];
  }

  if (!dryRun && !noGitChecks) {
    assertCleanWorkingTree();
  }

  if (dryRun) {
    console.info('[dry-run] Would create tags:');
    for (const tag of tags) {
      console.info(`🏷️ ${tag}`);
    }
    return tags;
  }

  const created: string[] = [];
  for (const tag of tags) {
    try {
      execFileSync('git', ['tag', '-a', tag, '-m', tag], { maxBuffer: GIT_OUTPUT_LIMIT });
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
    console.info(`🏷️ ${tag}`);
  }

  deleteFileIfExists(RELEASE_TAGS_FILE);
  deleteFileIfExists(RELEASE_SUMMARY_FILE);

  return tags;
}

/** Throw if the git working tree has uncommitted changes. */
function assertCleanWorkingTree(): void {
  try {
    execFileSync('git', ['diff', '--quiet'], { maxBuffer: GIT_OUTPUT_LIMIT });
    execFileSync('git', ['diff', '--quiet', '--cached'], { maxBuffer: GIT_OUTPUT_LIMIT });
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
