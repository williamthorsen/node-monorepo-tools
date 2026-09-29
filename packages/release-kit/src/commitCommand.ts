import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { GIT_OUTPUT_LIMIT, hasErrnoCode, parseArgsOrExit } from '@williamthorsen/nmr-core';

import { readReleaseTags, RELEASE_SUMMARY_FILE, resolveReleaseTagsPath } from './releaseFiles.ts';

const commitFlagSchema = {
  dryRun: { long: '--dry-run', type: 'boolean' as const },
};

/**
 * Runs the CLI `commit` command: reads the tags and summary files written by `prepare`, stages all changes, and
 * creates the release commit.
 */
export function commitCommand(argv: string[]): void {
  const dryRun = parseArgsOrExit(argv, commitFlagSchema).flags.dryRun;

  const tags = readReleaseTags();

  if (tags.length === 0) {
    throw new Error(`Tags file at ${resolveReleaseTagsPath()} is empty. Run \`release-kit prepare\` first.`);
  }

  // The summary file is absent when every released target lacks commits, as in a propagation-only release.
  let summary = '';
  try {
    summary = readFileSync(RELEASE_SUMMARY_FILE, 'utf8').trim();
  } catch (error: unknown) {
    if (hasErrnoCode(error, 'ENOENT')) {
      // Missing summary is acceptable.
    } else {
      throw error;
    }
  }

  const title = `release: ${tags.join(' ')}`;
  const message = summary.length > 0 ? `${title}\n\n${summary}` : title;

  if (dryRun) {
    console.info('[dry-run] Would create commit with message:\n');
    console.info(message);

    try {
      const status = execFileSync('git', ['status', '--porcelain'], {
        encoding: 'utf8',
        maxBuffer: GIT_OUTPUT_LIMIT,
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

  execFileSync('git', ['add', '-A'], { maxBuffer: GIT_OUTPUT_LIMIT });
  execFileSync('git', ['commit', '-m', message], { maxBuffer: GIT_OUTPUT_LIMIT });

  console.info(`Created release commit: ${title}`);
}
