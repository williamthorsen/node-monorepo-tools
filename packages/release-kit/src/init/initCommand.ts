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

/** Runs the eligibility checks, stopping at the first failure, and reports whether all passed. */
export function checkEligibility(styles: StreamStyles): boolean {
  printStep('Checking eligibility');

  if (!runRequiredCheck('Git repository detected', isGitRepo(), styles)) return false;
  if (!runRequiredCheck('package.json found', hasPackageJson(), styles)) return false;
  if (!runRequiredCheck('pnpm detected', usesPnpm(), styles)) return false;

  return true;
}

/** Runs the `release-kit init` command and returns the process exit code. */
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

  printStep('Detecting repo type');
  let repoType: RepoType;
  try {
    repoType = detectRepoType();
  } catch (error: unknown) {
    printError(`Failed to detect repo type: ${describeError(error)}`, styles.stderr);
    return 1;
  }
  printSuccess(`Detected: ${repoType}`, styles.stdout);

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

  printStep('Next steps');
  const configHint = withConfig
    ? '1. (Optional) Customize .config/release-kit.config.ts.'
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

// region | Helpers
/** Prints the result of a required check and reports whether it passed. */
function runRequiredCheck(label: string, result: CheckResult, styles: StreamStyles): boolean {
  if (result.ok) {
    printSuccess(label, styles.stdout);
    return true;
  }
  printError(result.message ?? `${label} failed`, styles.stderr);
  return false;
}
// endregion | Helpers
