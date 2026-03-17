import type { CheckResult } from './checks.ts';
import { hasPackageJson, isGitRepo, usesPnpm } from './checks.ts';
import { detectRepoType } from './detectRepoType.ts';
import { printError, printStep, printSuccess } from './prompt.ts';
import { scaffoldFiles } from './scaffold.ts';

interface InitOptions {
  dryRun: boolean;
  force: boolean;
  withConfig: boolean;
}

/** Run a required check and print the result. Returns false if the check failed. */
function runRequiredCheck(label: string, result: CheckResult): boolean {
  if (result.ok) {
    printSuccess(label);
    return true;
  }
  printError(result.message ?? `${label} failed`);
  return false;
}

/** Run all eligibility checks. Returns true if all checks pass. */
function checkEligibility(): boolean {
  printStep('Checking eligibility');

  if (!runRequiredCheck('Git repository detected', isGitRepo())) return false;
  if (!runRequiredCheck('package.json found', hasPackageJson())) return false;
  if (!runRequiredCheck('pnpm detected', usesPnpm())) return false;

  return true;
}

/**
 * Run the `release-kit init` command.
 *
 * Checks eligibility, detects repo type, scaffolds files, and prints next steps.
 * Returns the process exit code (0 for success, 1 for failure).
 */
export function initCommand({ dryRun, force, withConfig }: InitOptions): number {
  if (dryRun) {
    console.info('[dry-run mode]');
  }

  let eligible: boolean;
  try {
    eligible = checkEligibility();
  } catch (error: unknown) {
    printError(`Eligibility check failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (!eligible) return 1;

  // Detect repo type
  printStep('Detecting repo type');
  let repoType: ReturnType<typeof detectRepoType>;
  try {
    repoType = detectRepoType();
  } catch (error: unknown) {
    printError(`Failed to detect repo type: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  printSuccess(`Detected: ${repoType}`);

  // Scaffold files
  printStep('Scaffolding files');
  try {
    scaffoldFiles({ repoType, dryRun, overwrite: force, withConfig });
  } catch (error: unknown) {
    printError(`Failed to scaffold files: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  // Print next steps
  printStep('Next steps');
  const configHint = withConfig
    ? '1. (Optional) Customize .config/release-kit.config.ts and .config/git-cliff.toml.'
    : '1. (Optional) Run again with --with-config to scaffold config files.';
  console.info(`
  ${configHint}
  2. Test by running: npx @williamthorsen/release-kit prepare --dry-run
  3. Commit the generated files.
`);

  return 0;
}
