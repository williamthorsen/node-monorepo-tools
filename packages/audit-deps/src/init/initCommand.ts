import { printError, printStep, reportWriteResult } from '@williamthorsen/node-monorepo-core';

import { extractMessage } from '../cli.ts';
import { scaffoldConfig } from './scaffold.ts';

interface InitOptions {
  dryRun: boolean;
  force: boolean;
}

/**
 * Run the `audit-deps init` command.
 *
 * Scaffolds a starter config file, then prints next steps.
 * Returns the process exit code (0 for success, 1 for failure).
 */
export function initCommand({ dryRun, force }: InitOptions): number {
  if (dryRun) {
    console.info('[dry-run mode]');
  }

  printStep('Scaffolding config');
  let result: ReturnType<typeof scaffoldConfig>;
  try {
    result = scaffoldConfig({ dryRun, force });
  } catch (error: unknown) {
    printError(`Failed to scaffold config: ${extractMessage(error)}`);
    return 1;
  }

  reportWriteResult(result.configResult, dryRun);

  if (result.configResult.outcome === 'failed') {
    return 1;
  }

  if (!dryRun) {
    printStep('Next steps');
    console.info(`
  1. Customize .config/audit-deps.config.json with your severity thresholds.
  2. Run: npx @williamthorsen/audit-deps
  3. Commit the config file.
`);
  }

  return 0;
}
