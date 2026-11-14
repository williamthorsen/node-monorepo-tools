import { isAnticipatedFailure, printError, printStep, printSuccess, type StreamStyles } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { type CheckResult, hasPackageJson, isGitRepo, usesPnpm } from './checks.ts';
import { detectRepoType, type RepoType } from './detectRepoType.ts';

/** Runs the eligibility checks, stopping at the first failure, and reports whether all passed. */
export function checkEligibility(styles: StreamStyles): boolean {
  printStep('Checking eligibility');

  return (
    runRequiredCheck('Git repository detected', isGitRepo(), styles) &&
    runRequiredCheck('package.json found', hasPackageJson(), styles) &&
    runRequiredCheck('pnpm detected', usesPnpm(), styles)
  );
}

/**
 * Runs the preamble shared by the scaffolding commands and returns the detected repo type, or `undefined` once it has
 * reported a failed check or an anticipated error.
 */
export function resolveEligibleRepoType({
  isDryRun,
  styles,
}: {
  isDryRun: boolean;
  styles: StreamStyles;
}): RepoType | undefined {
  if (isDryRun) {
    console.info('[dry-run mode]');
  }

  let eligible: boolean;
  try {
    eligible = checkEligibility(styles);
  } catch (error: unknown) {
    if (!isAnticipatedFailure(error)) {
      throw error;
    }
    printError(`Eligibility check failed: ${describeError(error)}`, styles.stderr);
    return undefined;
  }
  if (!eligible) return undefined;

  printStep('Detecting repo type');
  let repoType: RepoType;
  try {
    repoType = detectRepoType();
  } catch (error: unknown) {
    if (!isAnticipatedFailure(error)) {
      throw error;
    }
    printError(`Failed to detect repo type: ${describeError(error)}`, styles.stderr);
    return undefined;
  }
  printSuccess(`Detected: ${repoType}`, styles.stdout);

  return repoType;
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
