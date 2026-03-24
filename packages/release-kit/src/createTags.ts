import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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
  } else {
    for (const tag of tags) {
      execFileSync('git', ['tag', '-a', tag, '-m', tag]);
    }
    console.info('Created tags:');
  }

  for (const tag of tags) {
    console.info(`🏷️ ${tag}`);
  }

  return tags;
}

/** Throw if the git working tree has uncommitted changes. */
function assertCleanWorkingTree(): void {
  try {
    execFileSync('git', ['diff', '--quiet']);
    execFileSync('git', ['diff', '--quiet', '--cached']);
  } catch {
    throw new Error(
      'Working tree is dirty. Commit or stash changes before tagging, or use `--no-git-checks` to skip this check.',
    );
  }
}
