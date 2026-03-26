import { printError, printStep } from '../lib/terminal.ts';
import { scaffoldConfig } from './scaffold.ts';

interface InitOptions {
  dryRun: boolean;
  force: boolean;
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
  try {
    const ok = scaffoldConfig({ dryRun, force });
    if (!ok) {
      return 1;
    }
  } catch (error: unknown) {
    printError(`Failed to scaffold config: ${error instanceof Error ? error.message : String(error)}`);
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
