/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { createTags } from './createTags.ts';

/**
 * Orchestrate the CLI `tag` command: parse flags and delegate to `createTags`.
 */
export function tagCommand(argv: string[]): void {
  // Help flags are handled upstream in the CLI entry point (bin/release-kit.ts).
  const knownFlags = new Set(['--dry-run', '--no-git-checks']);
  const unknownFlags = argv.filter((f) => !knownFlags.has(f));
  if (unknownFlags.length > 0) {
    console.error(`Error: Unknown option: ${unknownFlags[0]}`);
    process.exit(1);
  }

  const dryRun = argv.includes('--dry-run');
  const noGitChecks = argv.includes('--no-git-checks');

  try {
    createTags({ dryRun, noGitChecks });
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
