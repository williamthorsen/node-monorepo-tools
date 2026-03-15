import type { CheckResult } from './checks.ts';
import { hasCliffToml, hasPackageJson, isGitRepo, notAlreadyInitialized, usesPnpm } from './checks.ts';
import { detectRepoType } from './detectRepoType.ts';
import { confirm, printError, printStep, printSuccess } from './prompt.ts';
import { copyCliffTemplate, scaffoldFiles } from './scaffold.ts';

interface InitOptions {
  dryRun: boolean;
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

interface EligibilityResult {
  status: 'pass' | 'abort' | 'fail';
  overwrite: boolean;
}

/** Run all eligibility checks. Returns the check status and whether overwrite was confirmed. */
async function checkEligibility(dryRun: boolean): Promise<EligibilityResult> {
  printStep('Checking eligibility');

  if (!runRequiredCheck('Git repository detected', isGitRepo())) return { status: 'fail', overwrite: false };
  if (!runRequiredCheck('package.json found', hasPackageJson())) return { status: 'fail', overwrite: false };
  if (!runRequiredCheck('pnpm detected', usesPnpm())) return { status: 'fail', overwrite: false };

  const cliffCheck = hasCliffToml();
  if (cliffCheck.ok) {
    printSuccess('cliff.toml found');
  } else {
    console.info('');
    const shouldCreate = await confirm('No cliff.toml found. Create one from the bundled template?');
    if (shouldCreate) {
      copyCliffTemplate(dryRun);
    } else {
      printError('cliff.toml is required for changelog generation. Aborting.');
      return { status: 'fail', overwrite: false };
    }
  }

  const initCheck = notAlreadyInitialized();
  if (!initCheck.ok) {
    console.info('');
    const shouldOverwrite = await confirm('release-kit appears to be already initialized. Overwrite existing files?');
    if (!shouldOverwrite) {
      console.info('Aborting.');
      return { status: 'abort', overwrite: false };
    }
    return { status: 'pass', overwrite: true };
  }

  return { status: 'pass', overwrite: false };
}

/**
 * Run the `release-kit init` command.
 *
 * Checks eligibility, detects repo type, scaffolds files, and prints next steps.
 * Returns the process exit code (0 for success, 1 for failure).
 */
export async function initCommand({ dryRun }: InitOptions): Promise<number> {
  if (dryRun) {
    console.info('[dry-run mode]');
  }

  let eligibility: EligibilityResult;
  try {
    eligibility = await checkEligibility(dryRun);
  } catch (error: unknown) {
    printError(`Eligibility check failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (eligibility.status === 'fail') return 1;
  if (eligibility.status === 'abort') return 0;

  // Detect repo type
  printStep('Detecting repo type');
  const repoType = detectRepoType();
  printSuccess(`Detected: ${repoType}`);

  // Scaffold files
  printStep('Scaffolding files');
  scaffoldFiles({ repoType, dryRun, overwrite: eligibility.overwrite });

  // Print next steps
  printStep('Next steps');
  console.info(`
  1. (Optional) Customize .config/release-kit.config.ts to exclude components, override version patterns, add custom work types, etc.
  2. Test by running: npx @williamthorsen/release-kit prepare --dry-run
  3. Commit the generated workflow file (and config file if created).
`);

  return 0;
}
