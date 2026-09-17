import {
  printError,
  printStep,
  printSuccess,
  reportWriteResult,
  type StreamStyles,
  type WriteResult,
} from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { type CheckResult, hasPackageJson, isGitRepo, usesPnpm } from './checks.ts';
import { detectRepoType, type RepoType } from './detectRepoType.ts';
import { scaffoldFiles } from './scaffold.ts';

interface InitOptions {
  dryRun: boolean;
  force: boolean;
  styles: StreamStyles;
  withConfig: boolean;
}

/** Run a required check and print the result. Returns false if the check failed. */
function runRequiredCheck(label: string, result: CheckResult, styles: StreamStyles): boolean {
  if (result.ok) {
    printSuccess(label, styles.stdout);
    return true;
  }
  printError(result.message ?? `${label} failed`, styles.stderr);
  return false;
}

/** Run all eligibility checks. Returns true if all checks pass. */
function checkEligibility(styles: StreamStyles): boolean {
  printStep('Checking eligibility');

  if (!runRequiredCheck('Git repository detected', isGitRepo(), styles)) return false;
  if (!runRequiredCheck('package.json found', hasPackageJson(), styles)) return false;
  if (!runRequiredCheck('pnpm detected', usesPnpm(), styles)) return false;

  return true;
}

/**
 * Run the `release-kit init` command.
 *
 * Checks eligibility, detects repo type, scaffolds files, and prints next steps.
 * Returns the process exit code (0 for success, 1 for failure).
 */
export function initCommand({ dryRun, force, styles, withConfig }: InitOptions): number {
  if (dryRun) {
    console.info('[dry-run mode]');
  }

  let eligible: boolean;
  try {
    eligible = checkEligibility(styles);
  } catch (error: unknown) {
    printError(`Eligibility check failed: ${describeError(error)}`, styles.stderr);
    return 1;
  }
  if (!eligible) return 1;

  // Detect repo type
  printStep('Detecting repo type');
  let repoType: RepoType;
  try {
    repoType = detectRepoType();
  } catch (error: unknown) {
    printError(`Failed to detect repo type: ${describeError(error)}`, styles.stderr);
    return 1;
  }
  printSuccess(`Detected: ${repoType}`, styles.stdout);

  // Scaffold files
  printStep('Scaffolding files');
  let results: WriteResult[];
  try {
    results = scaffoldFiles({ repoType, dryRun, overwrite: force, withConfig });
  } catch (error: unknown) {
    printError(`Failed to scaffold files: ${describeError(error)}`, styles.stderr);
    return 1;
  }

  for (const result of results) {
    reportWriteResult(result, dryRun, styles);
  }

  if (results.some((r) => r.outcome === 'failed')) {
    return 1;
  }

  // Print next steps
  printStep('Next steps');
  const configHint = withConfig
    ? '1. (Optional) Customize .config/release-kit.config.ts and .config/git-cliff.toml.'
    : '1. (Optional) Run again with --with-config to scaffold config files.';
  console.info(`
  ${configHint}
  2. If this is a public repo, set provenance: true in .github/workflows/publish.yaml.
  3. Test by running: npx @williamthorsen/release-kit prepare --dry-run
  4. Commit the generated files.
  5. Register each package as a trusted publisher on npmjs.com.
`);

  return 0;
}
