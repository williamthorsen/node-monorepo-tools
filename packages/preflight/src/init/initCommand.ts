import { printError, printSkip, printStep, printSuccess } from '@williamthorsen/node-monorepo-core';
import type { WriteResult } from '@williamthorsen/node-monorepo-core';

import { scaffoldConfig } from './scaffold.ts';

interface InitOptions {
  dryRun: boolean;
  force: boolean;
}

/** Print a terminal message for a write result based on its outcome. */
function reportResult(result: WriteResult, dryRun: boolean): void {
  switch (result.outcome) {
    case 'created':
      if (dryRun) {
        printSuccess(`[dry-run] Would create ${result.filePath}`);
      } else {
        printSuccess(`Created ${result.filePath}`);
      }
      break;
    case 'overwritten':
      if (dryRun) {
        printSuccess(`[dry-run] Would overwrite ${result.filePath}`);
      } else {
        printSuccess(`Overwrote ${result.filePath}`);
      }
      break;
    case 'up-to-date':
      printSuccess(`${result.filePath} (up to date)`);
      break;
    case 'skipped':
      printSkip(`${result.filePath} (already exists)`);
      break;
    case 'failed':
      printError(`Failed to write ${result.filePath}`);
      break;
  }
}

/**
 * Run the `preflight init` command.
 *
 * Scaffolds a starter config file and prints next steps.
 * Returns the process exit code (0 for success, 1 for failure).
 */
export function initCommand({ dryRun, force }: InitOptions): number {
  if (dryRun) {
    console.info('[dry-run mode]');
  }

  printStep('Scaffolding config');
  let result: WriteResult;
  try {
    result = scaffoldConfig({ dryRun, force });
  } catch (error: unknown) {
    printError(`Failed to scaffold config: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  reportResult(result, dryRun);

  if (result.outcome === 'failed') {
    return 1;
  }

  if (!dryRun) {
    printStep('Next steps');
    console.info(`
  1. Customize .config/preflight.config.ts with your checklists and checks.
  2. Test by running: npx @williamthorsen/preflight run
  3. Commit the generated file.
`);
  }

  return 0;
}
