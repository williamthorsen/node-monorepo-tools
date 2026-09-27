/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { parseArgsOrExit, reportError, type StreamStyles } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { createTags } from './createTags.ts';

const tagFlagSchema = {
  dryRun: { long: '--dry-run', type: 'boolean' as const },
  noGitChecks: { long: '--no-git-checks', type: 'boolean' as const },
};

/** Runs the CLI `tag` command: parses flags and delegates to `createTags`. */
export function tagCommand(argv: string[], styles: StreamStyles): void {
  // The CLI entry point handles help flags before dispatching here.
  const { dryRun, noGitChecks } = parseArgsOrExit(argv, tagFlagSchema).flags;

  try {
    createTags({ dryRun, noGitChecks, style: styles.stdout });
  } catch (error: unknown) {
    reportError(describeError(error));
    process.exit(1);
  }
}
