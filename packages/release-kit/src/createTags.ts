import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';

import { RELEASE_TAGS_FILE } from './runReleasePrepare.ts';

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

  let content: string;
  try {
    content = readFileSync(RELEASE_TAGS_FILE, 'utf8');
  } catch {
    throw new Error('No tags file found. Run `release-kit prepare` first.');
  }

  const tags = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

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
      execFileSync('git', ['tag', '-a', tag, '-m', tag]);
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

  deleteTagsFile();

  return tags;
}

/** Remove the tags file after successful tag creation. Tolerate missing file. */
function deleteTagsFile(): void {
  try {
    unlinkSync(RELEASE_TAGS_FILE);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

/** Throw if the git working tree has uncommitted changes. */
function assertCleanWorkingTree(): void {
  try {
    execFileSync('git', ['diff', '--quiet']);
    execFileSync('git', ['diff', '--quiet', '--cached']);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw error;
    }
    throw new Error(
      'Working tree is dirty. Commit or stash changes before tagging, or use `--no-git-checks` to skip this check.',
    );
  }
}
