/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { parseArgsOrExit, reportError, type StreamStyles } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { createTags } from './createTags.ts';

const tagFlagSchema = {
  isDryRun: { long: '--dry-run', type: 'boolean' as const },
  shouldSkipGitChecks: { long: '--no-git-checks', type: 'boolean' as const },
};

/** Runs the CLI `tag` command: parses flags and delegates to `createTags`. */
export function tagCommand(argv: string[], styles: StreamStyles): void {
  // The CLI entry point handles help flags before dispatching here.
  const { isDryRun, shouldSkipGitChecks } = parseArgsOrExit(argv, tagFlagSchema).flags;

  try {
    createTags({ isDryRun, shouldSkipGitChecks, style: styles.stdout });
  } catch (error: unknown) {
    reportError(describeError(error));
    process.exit(1);
  }
}
