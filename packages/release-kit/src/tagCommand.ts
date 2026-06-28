/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { parseArgsOrExit } from '@williamthorsen/nmr-core';

import { createTags } from './createTags.ts';

const tagFlagSchema = {
  dryRun: { long: '--dry-run', type: 'boolean' as const },
  noGitChecks: { long: '--no-git-checks', type: 'boolean' as const },
};

/** Orchestrate the CLI `tag` command: parse flags and delegate to `createTags`. */
export function tagCommand(argv: string[]): void {
  // Help flags are handled upstream in the CLI entry point (bin/release-kit.ts).
  const { dryRun, noGitChecks } = parseArgsOrExit(argv, tagFlagSchema).flags;

  try {
    createTags({ dryRun, noGitChecks });
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
