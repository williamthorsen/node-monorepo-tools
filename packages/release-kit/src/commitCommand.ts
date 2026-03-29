/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { RELEASE_SUMMARY_FILE, RELEASE_TAGS_FILE } from './prepareCommand.ts';

/**
 * Orchestrate the CLI `commit` command.
 *
 * Reads the tags and summary files produced by `prepare`, stages all
 * changes, and creates a release commit with a formatted message.
 */
export function commitCommand(argv: string[]): void {
  const knownFlags = new Set(['--dry-run']);
  const unknownFlags = argv.filter((f) => !knownFlags.has(f));
  if (unknownFlags.length > 0) {
    console.error(`Error: Unknown option: ${unknownFlags[0]}`);
    process.exit(1);
  }

  const dryRun = argv.includes('--dry-run');

  // Read tags file.
  let tagsContent: string;
  try {
    tagsContent = readFileSync(RELEASE_TAGS_FILE, 'utf8');
  } catch {
    throw new Error('No tags file found. Run `release-kit prepare` first.');
  }

  const tags = tagsContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (tags.length === 0) {
    throw new Error('Tags file is empty. Run `release-kit prepare` first.');
  }

  // Read summary file (optional — may not exist for propagation-only releases).
  let summary = '';
  try {
    summary = readFileSync(RELEASE_SUMMARY_FILE, 'utf8').trim();
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      // Missing summary is acceptable.
    } else {
      throw error;
    }
  }

  // Build commit message.
  const title = `release: ${tags.join(' ')}`;
  const message = summary.length > 0 ? `${title}\n\n${summary}` : title;

  if (dryRun) {
    console.info('[dry-run] Would create commit with message:\n');
    console.info(message);

    try {
      const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
      if (status.trim().length > 0) {
        console.info('\nUncommitted changes:');
        console.info(status.trimEnd());
      }
    } catch {
      console.info('(Could not determine uncommitted changes)');
    }

    return;
  }

  // Stage all changes and create the commit.
  execFileSync('git', ['add', '-A']);
  execFileSync('git', ['commit', '-m', message]);

  console.info(`Created release commit: ${title}`);
}
