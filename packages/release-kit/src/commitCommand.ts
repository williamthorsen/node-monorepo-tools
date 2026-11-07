import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { GIT_OUTPUT_LIMIT_BYTES, hasErrnoCode, UserError } from '@williamthorsen/nmr-core';

import { readReleaseTags, RELEASE_SUMMARY_FILE, resolveReleaseTagsPath } from './releaseFiles.ts';
import { asUserError } from './user-error-chaining.ts';

export interface CommitCommandOptions {
  isDryRun: boolean;
}

/**
 * Runs the CLI `commit` command: reads the tags and summary files written by `prepare`, stages all changes, and
 * creates the release commit.
 */
export function commitCommand({ isDryRun }: CommitCommandOptions): void {
  const tags = readReleaseTags();

  if (tags.length === 0) {
    throw new UserError(`Tags file at ${resolveReleaseTagsPath()} is empty. Run \`release-kit prepare\` first.`);
  }

  // The summary file is absent when every released target lacks commits, as in a propagation-only release.
  let summary = '';
  try {
    summary = readFileSync(RELEASE_SUMMARY_FILE, 'utf8').trim();
  } catch (error: unknown) {
    if (hasErrnoCode(error, 'ENOENT')) {
      // Missing summary is acceptable.
    } else {
      throw asUserError(error);
    }
  }

  const title = `release: ${tags.join(' ')}`;
  const message = summary.length > 0 ? `${title}\n\n${summary}` : title;

  if (isDryRun) {
    console.info('[dry-run] Would create commit with message:\n');
    console.info(message);

    try {
      const status = execFileSync('git', ['status', '--porcelain'], {
        encoding: 'utf8',
        maxBuffer: GIT_OUTPUT_LIMIT_BYTES,
      });
      if (status.trim().length > 0) {
        console.info('\nUncommitted changes:');
        console.info(status.trimEnd());
      }
    } catch {
      console.info('(Could not determine uncommitted changes)');
    }

    return;
  }

  try {
    execFileSync('git', ['add', '-A'], { maxBuffer: GIT_OUTPUT_LIMIT_BYTES });
    execFileSync('git', ['commit', '-m', message], { maxBuffer: GIT_OUTPUT_LIMIT_BYTES });
  } catch (error: unknown) {
    throw asUserError(error);
  }

  console.info(`Created release commit: ${title}`);
}
