import { printError, printStep, reportWriteResult } from '@williamthorsen/node-monorepo-core';

import { extractMessage } from '../cli.ts';
import { scaffoldFiles } from './scaffold.ts';

interface InitOptions {
  dryRun: boolean;
  force: boolean;
}

/**
 * Run the `audit-deps init` command.
 *
 * Scaffolds the starter config file and the GitHub Actions workflow, then prints next steps.
 * Returns the process exit code (0 for success, 1 if any write failed).
 */
export function initCommand({ dryRun, force }: InitOptions): number {
  if (dryRun) {
    console.info('[dry-run mode]');
  }

  printStep('Scaffolding files');
  let results: ReturnType<typeof scaffoldFiles>;
  try {
    results = scaffoldFiles({ dryRun, force });
  } catch (error: unknown) {
    printError(`Failed to scaffold files: ${extractMessage(error)}`);
    return 1;
  }

  for (const result of results) {
    reportWriteResult(result, dryRun);
  }

  if (results.some((r) => r.outcome === 'failed')) {
    return 1;
  }

  if (!dryRun) {
    printStep('Next steps');
    console.info(`
  1. Customize .config/audit-deps.config.json with your severity thresholds.
  2. Commit the scaffolded .github/workflows/audit.yaml alongside your config.
  3. Run: npx @williamthorsen/audit-deps
`);
  }

  return 0;
}
