import { reportWriteResult, writeFileWithCheck } from '@williamthorsen/node-monorepo-core';

import { discoverWorkspaces } from '../discoverWorkspaces.ts';
import { generateCommand, LABELS_OUTPUT_PATH } from './generateCommand.ts';
import { SYNC_LABELS_CONFIG_PATH } from './loadSyncLabelsConfig.ts';
import { buildScopeLabels, syncLabelsConfigScript, syncLabelsWorkflow } from './templates.ts';

/** Options for the `sync-labels init` subcommand. */
interface InitOptions {
  dryRun: boolean;
  force: boolean;
}

/** Caller workflow output path. */
const WORKFLOW_PATH = '.github/workflows/sync-labels.yaml';

/**
 * Run the `sync-labels init` subcommand.
 *
 * Detects repo type, discovers workspaces, scaffolds the caller workflow and config file,
 * then runs `generate` to produce `.github/labels.yaml`. Returns 0 on success, 1 on failure.
 */
export async function syncLabelsInitCommand({ dryRun, force }: InitOptions): Promise<number> {
  if (dryRun) {
    console.info('[dry-run mode]');
  }

  console.info('\n> Discovering workspaces');

  let workspacePaths: string[] | undefined;
  try {
    workspacePaths = await discoverWorkspaces();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  Failed to discover workspaces: ${message}`);
    return 1;
  }

  const scopeLabels = workspacePaths === undefined ? [] : buildScopeLabels(workspacePaths);
  if (workspacePaths === undefined) {
    console.info('  No pnpm workspaces found (single-package repo)');
  } else {
    console.info(`  Found ${String(workspacePaths.length)} workspaces`);
  }

  // Scaffold caller workflow
  console.info('\n> Scaffolding files');
  const workflowResult = writeFileWithCheck(WORKFLOW_PATH, syncLabelsWorkflow(), { dryRun, overwrite: force });
  const configResult = writeFileWithCheck(SYNC_LABELS_CONFIG_PATH, syncLabelsConfigScript(scopeLabels), {
    dryRun,
    overwrite: force,
  });

  reportWriteResult(workflowResult, dryRun);
  reportWriteResult(configResult, dryRun);

  if (workflowResult.outcome === 'failed' || configResult.outcome === 'failed') {
    console.error('Failed to scaffold one or more files.');
    return 1;
  }

  // Generate .github/labels.yaml
  if (dryRun) {
    console.info(`\n> [dry-run] Would generate ${LABELS_OUTPUT_PATH}`);
  } else {
    console.info('\n> Generating labels');
    const generateExitCode = await generateCommand();
    if (generateExitCode !== 0) {
      return generateExitCode;
    }
  }

  // Print summary
  console.info(`
> Next steps
  1. Review the generated files:
     - ${WORKFLOW_PATH}
     - ${SYNC_LABELS_CONFIG_PATH}
     - ${LABELS_OUTPUT_PATH}
  2. Customize ${SYNC_LABELS_CONFIG_PATH} as needed, then re-run \`release-kit sync-labels generate\`.
  3. Commit the generated files.
  4. Run \`release-kit sync-labels sync\` to apply labels to your GitHub repo.
`);

  return 0;
}
