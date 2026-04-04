/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { parseArgs } from '@williamthorsen/node-monorepo-core';

import { createTags } from './createTags.ts';

const tagFlagSchema = {
  dryRun: { long: '--dry-run', type: 'boolean' as const },
  noGitChecks: { long: '--no-git-checks', type: 'boolean' as const },
};

/** Orchestrate the CLI `tag` command: parse flags and delegate to `createTags`. */
export function tagCommand(argv: string[]): void {
  // Help flags are handled upstream in the CLI entry point (bin/release-kit.ts).
  let parsed;
  try {
    parsed = parseArgs(argv, tagFlagSchema);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const flagMatch = message.match(/^unknown flag '(.+)'$/);
    if (flagMatch?.[1] !== undefined) {
      console.error(`Error: Unknown option: ${flagMatch[1]}`);
    } else {
      console.error(`Error: ${message}`);
    }
    process.exit(1);
  }

  const { dryRun, noGitChecks } = parsed.flags;

  try {
    createTags({ dryRun, noGitChecks });
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
