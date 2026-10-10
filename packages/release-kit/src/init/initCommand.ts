import {
  printError,
  printSkip,
  printStep,
  printSuccess,
  reportWriteResult,
  type StreamStyles,
  type WriteResult,
} from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { type CheckResult, hasPackageJson, isGitRepo, usesPnpm } from './checks.ts';
import { detectRepoType, type RepoType } from './detectRepoType.ts';
import { formatPrivateWorkflowSkip, hasPublishablePackage } from './hasPublishablePackage.ts';
import { PUBLISHING_WORKFLOW_PATHS, scaffoldFiles } from './scaffold.ts';

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

  const publishable = hasPublishablePackage();

  printStep('Scaffolding files');
  if (!publishable) {
    for (const filePath of PUBLISHING_WORKFLOW_PATHS) {
      printSkip(formatPrivateWorkflowSkip(filePath), styles.stdout);
    }
  }

  let results: WriteResult[];
  try {
    results = scaffoldFiles({ repoType, dryRun, overwrite: force, publishable, withConfig });
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
  console.info(`\n${formatNextSteps({ publishable, withConfig })}\n`);

  return 0;
}

// region | Helpers
/** Formats the numbered next steps, leaving out the publishing steps when the repo does not publish any package. */
function formatNextSteps({ publishable, withConfig }: { publishable: boolean; withConfig: boolean }): string {
  const steps = [
    withConfig
      ? '(Optional) Customize .config/release-kit.config.ts.'
      : '(Optional) Run again with --with-config to scaffold config files.',
    ...(publishable ? ['If this is a private repo, remove provenance: true from .github/workflows/publish.yaml.'] : []),
    'Test by running: npx @williamthorsen/release-kit prepare --dry-run',
    'Commit the generated files.',
    ...(publishable ? ['Register each package as a trusted publisher on npmjs.com.'] : []),
  ];
  return steps.map((step, index) => `  ${String(index + 1)}. ${step}`).join('\n');
}

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
