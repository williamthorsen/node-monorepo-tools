import {
  isAnticipatedFailure,
  printError,
  printSkip,
  printStep,
  reportWriteResult,
  type StreamStyles,
  type WriteResult,
} from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { resolveEligibleRepoType } from './eligibility.ts';
import { formatPrivateWorkflowSkip, hasPublishablePackage } from './hasPublishablePackage.ts';
import { PUBLISHING_WORKFLOW_PATHS, scaffoldFiles } from './scaffold.ts';

interface InitOptions {
  isDryRun: boolean;
  shouldForce: boolean;
  styles: StreamStyles;
  shouldScaffoldConfig: boolean;
}

/** Runs the `release-kit init` command and returns the process exit code. */
export function initCommand({ isDryRun, shouldForce, styles, shouldScaffoldConfig }: InitOptions): number {
  const repoType = resolveEligibleRepoType({ isDryRun, styles });
  if (repoType === undefined) return 1;

  const publishable = hasPublishablePackage();

  printStep('Scaffolding files');
  if (!publishable) {
    for (const filePath of PUBLISHING_WORKFLOW_PATHS) {
      printSkip(formatPrivateWorkflowSkip(filePath), styles.stdout);
    }
  }

  let results: WriteResult[];
  try {
    results = scaffoldFiles({ repoType, isDryRun, shouldOverwrite: shouldForce, publishable, shouldScaffoldConfig });
  } catch (error: unknown) {
    if (!isAnticipatedFailure(error)) {
      throw error;
    }
    printError(`Failed to scaffold files: ${describeError(error)}`, styles.stderr);
    return 1;
  }

  for (const result of results) {
    reportWriteResult(result, isDryRun, styles);
  }

  if (results.some((r) => r.outcome === 'failed')) {
    return 1;
  }

  printStep('Next steps');
  console.info(`\n${formatNextSteps({ publishable, shouldScaffoldConfig })}\n`);

  return 0;
}

// region | Helpers
/** Formats the numbered next steps, leaving out the publishing steps when the repo does not publish any package. */
function formatNextSteps({
  publishable,
  shouldScaffoldConfig,
}: {
  publishable: boolean;
  shouldScaffoldConfig: boolean;
}): string {
  const steps = [
    shouldScaffoldConfig
      ? '(Optional) Customize .config/release-kit.config.ts.'
      : '(Optional) Run again with --with-config to scaffold config files.',
    ...(publishable ? ['If this is a private repo, remove provenance: true from .github/workflows/publish.yaml.'] : []),
    'Test by running: npx @williamthorsen/release-kit prepare --dry-run',
    'Commit the generated files.',
    ...(publishable ? ['Register each package as a trusted publisher on npmjs.com.'] : []),
  ];
  return steps.map((step, index) => `  ${String(index + 1)}. ${step}`).join('\n');
}
// endregion | Helpers
