/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { parseArgs, type ParsedArgs, translateParseError } from '@williamthorsen/nmr-core';

import { check, sync } from './commands/sync-agent-files.ts';
import { findMonorepoRoot } from './context.ts';

const flagSchema = {
  check: { long: '--check', type: 'boolean' as const },
};

const { flags } = parseArgsOrExit(process.argv.slice(2));

try {
  runCommand(flags.check);
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

// region | Helpers

/** Parses argv against the flag schema, printing a usage error and exiting on failure. */
function parseArgsOrExit(argv: string[]): ParsedArgs<typeof flagSchema> {
  try {
    return parseArgs(argv, flagSchema);
  } catch (error: unknown) {
    console.error(`Error: ${translateParseError(error)}`);
    process.exit(1);
  }
}

/** Runs sync (default) or check (`--check`), printing the outcome and exiting with the right code. */
function runCommand(checkOnly: boolean): void {
  const monorepoRoot = findMonorepoRoot();

  if (!checkOnly) {
    const { path: destinationPath, packageSpecifier, changed } = sync(monorepoRoot);
    console.info(
      changed ? `✓ Wrote ${destinationPath} (${packageSpecifier})` : `✓ ${destinationPath} already up to date`,
    );
    process.exit(0);
  }

  const result = check(monorepoRoot);
  if (result.ok) {
    console.info('✓ .agents/nmr/AGENTS.md is in sync');
    process.exit(0);
  }
  console.error(result.reason);
  process.exit(1);
}

// endregion | Helpers
