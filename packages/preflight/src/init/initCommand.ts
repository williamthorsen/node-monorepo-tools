import { printError, printStep, reportWriteResult } from '@williamthorsen/node-monorepo-core';

import { scaffoldConfig } from './scaffold.ts';

interface InitOptions {
  dryRun: boolean;
  force: boolean;
}

/**
 * Run the `preflight init` command.
 *
 * Scaffolds a starter config file and collection file, then prints next steps.
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
    printError(`Failed to scaffold config: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  reportWriteResult(result.configResult, dryRun);
  reportWriteResult(result.collectionResult, dryRun);

  if (result.configResult.outcome === 'failed' || result.collectionResult.outcome === 'failed') {
    return 1;
  }

  if (!dryRun) {
    printStep('Next steps');
    console.info(`
  1. Customize .config/preflight.config.ts with your compile settings.
  2. Add checklists to .preflight/collections/.
  3. Test by running: npx @williamthorsen/preflight run
  4. Commit the generated files.
`);
  }

  return 0;
}
