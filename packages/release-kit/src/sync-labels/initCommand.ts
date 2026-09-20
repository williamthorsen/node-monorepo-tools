import { existsSync } from 'node:fs';

import { reportWriteResult, type StreamStyles, writeFileWithCheck } from '@williamthorsen/nmr-core';
import type { WorkspaceResolution } from '@williamthorsen/nmr-core/workspace';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { describeEmptyWorkspace, discoverWorkspaces } from '../discoverWorkspaces.ts';
import { CONFIG_FILE_PATH } from '../loadConfig.ts';
import { loadValidatedConfig } from '../loadValidatedConfig.ts';
import { generateCommand, LABELS_OUTPUT_PATH } from './generateCommand.ts';
import { checkRetiredSyncLabelsConfig } from './retiredConfig.ts';
import { buildScopeLabels, renderRepoLabelsBlock, repoLabelsConfigScript, syncLabelsWorkflow } from './templates.ts';
import type { LabelDefinition } from './types.ts';

/** Options for the `sync-labels init` subcommand. */
interface InitOptions {
  /** Config file to read, relative to the working directory. Defaults to `CONFIG_FILE_PATH`. */
  configPath?: string;
  dryRun: boolean;
  force: boolean;
  styles: StreamStyles;
}

/** Caller workflow output path. */
const WORKFLOW_PATH = '.github/workflows/sync-labels.yaml';

/**
 * Run the `sync-labels init` subcommand.
 *
 * Discovers workspaces and retired packages, scaffolds the caller workflow, then seeds the
 * `repoLabels` block: into a new config file when none exists, or printed to stdout for manual
 * paste when the file is already there — an existing, hand-authored config is never rewritten.
 * Returns 0 on success, 1 on failure.
 *
 * `configPath` names the config to read. Naming one that does not exist fails the command, so the
 * scaffolding branch is reached only under the default path and always writes to `CONFIG_FILE_PATH`.
 */
export async function syncLabelsInitCommand({ configPath, dryRun, force, styles }: InitOptions): Promise<number> {
  const configFilePath = configPath ?? CONFIG_FILE_PATH;

  if (checkRetiredSyncLabelsConfig(configPath)) {
    return 1;
  }

  if (dryRun) {
    console.info('[dry-run mode]');
  }

  console.info('\n> Discovering workspaces');

  let workspace: WorkspaceResolution;
  try {
    workspace = discoverWorkspaces();
  } catch (error: unknown) {
    const message = describeError(error);
    process.stderr.write(`  Failed to discover workspaces: ${message}\n`);
    return 1;
  }

  if (workspace.kind === 'empty') {
    process.stderr.write(`  No workspace package to label. ${describeEmptyWorkspace(workspace)}\n`);
    return 1;
  }

  if (workspace.kind === 'not-a-workspace') {
    console.info('  No pnpm workspaces found (single-package repo)');
  } else {
    console.info(`  Found ${String(workspace.packageDirs.length)} workspaces`);
  }

  // A named path is always read, so that one which does not exist fails in the loader rather than
  // silently routing the run into the scaffolding branch.
  const configExists = configPath !== undefined || existsSync(CONFIG_FILE_PATH);
  const retiredNames = configExists ? await loadRetiredPackageNames(styles, configPath) : [];
  if (retiredNames === undefined) {
    return 1;
  }

  const scopeLabels: LabelDefinition[] =
    workspace.kind === 'not-a-workspace' ? [] : buildScopeLabels(workspace.packageDirs, retiredNames);

  // Scaffold caller workflow
  console.info('\n> Scaffolding files');
  const workflowResult = writeFileWithCheck(WORKFLOW_PATH, syncLabelsWorkflow(), { dryRun, overwrite: force });
  reportWriteResult(workflowResult, dryRun, styles);

  // Seed the repoLabels block: print for manual paste when the config exists, write a new file otherwise.
  if (configExists) {
    console.info(`\n> ${configFilePath} already exists; add this block to the object passed to defineConfig:\n`);
    console.info(renderRepoLabelsBlock(scopeLabels));

    if (workflowResult.outcome === 'failed') {
      process.stderr.write('Failed to scaffold one or more files.\n');
      return 1;
    }

    console.info(`
> Next steps
  1. Paste the block above into ${configFilePath}.
  2. Run \`release-kit sync-labels generate\` to produce ${LABELS_OUTPUT_PATH}.
  3. Commit the changes.
  4. Run \`release-kit sync-labels sync\` to apply labels to your GitHub repo.
`);
    return 0;
  }

  const configResult = writeFileWithCheck(CONFIG_FILE_PATH, repoLabelsConfigScript(scopeLabels), {
    dryRun,
    overwrite: force,
  });
  reportWriteResult(configResult, dryRun, styles);

  if (workflowResult.outcome === 'failed' || configResult.outcome === 'failed') {
    process.stderr.write('Failed to scaffold one or more files.\n');
    return 1;
  }

  // Generate .github/labels.yaml
  if (dryRun) {
    console.info(`\n> [dry-run] Would generate ${LABELS_OUTPUT_PATH}`);
  } else {
    console.info('\n> Generating labels');
    const generateExitCode = await generateCommand({ styles });
    if (generateExitCode !== 0) {
      return generateExitCode;
    }
  }

  // Print summary
  console.info(`
> Next steps
  1. Review the generated files:
     - ${WORKFLOW_PATH}
     - ${CONFIG_FILE_PATH}
     - ${LABELS_OUTPUT_PATH}
  2. Customize the \`repoLabels\` block in ${CONFIG_FILE_PATH} as needed, then re-run \`release-kit sync-labels generate\`.
  3. Commit the generated files.
  4. Run \`release-kit sync-labels sync\` to apply labels to your GitHub repo.
`);

  return 0;
}

/**
 * Load the existing config and return the unscoped names of its `retiredPackages`.
 *
 * Returns `undefined` when the config cannot be loaded or validated — init must not seed
 * a label set from a config it cannot read.
 */
async function loadRetiredPackageNames(styles: StreamStyles, configPath?: string): Promise<string[] | undefined> {
  const result = await loadValidatedConfig(styles.stderr, configPath);
  if (result.status === 'invalid') {
    return undefined;
  }
  if (result.status === 'missing') {
    return [];
  }
  return (result.config.retiredPackages ?? []).map((retired) => toUnscopedName(retired.name));
}

/** Strip the npm scope from a package name (`@scope/name` → `name`). */
function toUnscopedName(name: string): string {
  return name.startsWith('@') ? name.slice(name.indexOf('/') + 1) : name;
}
