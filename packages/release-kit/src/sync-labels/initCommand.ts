import { existsSync } from 'node:fs';

import { reportError, reportWriteResult, writeFileWithCheck } from '@williamthorsen/nmr-core';

import { discoverWorkspaces } from '../discoverWorkspaces.ts';
import { CONFIG_FILE_PATH, loadConfig } from '../loadConfig.ts';
import { validateConfig } from '../validateConfig.ts';
import { generateCommand, LABELS_OUTPUT_PATH } from './generateCommand.ts';
import { checkRetiredSyncLabelsConfig } from './retiredConfig.ts';
import { buildScopeLabels, renderRepoLabelsBlock, repoLabelsConfigScript, syncLabelsWorkflow } from './templates.ts';
import type { LabelDefinition } from './types.ts';

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
 * Discovers workspaces and retired packages, scaffolds the caller workflow, then seeds the
 * `repoLabels` block: into a new `.config/release-kit.config.ts` when none exists, or
 * printed to stdout for manual paste when the file is already there — an existing,
 * hand-authored config is never rewritten. Returns 0 on success, 1 on failure.
 */
export async function syncLabelsInitCommand({ dryRun, force }: InitOptions): Promise<number> {
  if (checkRetiredSyncLabelsConfig()) {
    return 1;
  }

  if (dryRun) {
    console.info('[dry-run mode]');
  }

  console.info('\n> Discovering workspaces');

  let workspacePaths: string[] | undefined;
  try {
    workspacePaths = await discoverWorkspaces();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`  Failed to discover workspaces: ${message}\n`);
    return 1;
  }

  if (workspacePaths === undefined) {
    console.info('  No pnpm workspaces found (single-package repo)');
  } else {
    console.info(`  Found ${String(workspacePaths.length)} workspaces`);
  }

  const configExists = existsSync(CONFIG_FILE_PATH);
  const retiredNames = configExists ? await loadRetiredPackageNames() : [];
  if (retiredNames === undefined) {
    return 1;
  }

  const scopeLabels: LabelDefinition[] =
    workspacePaths === undefined ? [] : buildScopeLabels(workspacePaths, retiredNames);

  // Scaffold caller workflow
  console.info('\n> Scaffolding files');
  const workflowResult = writeFileWithCheck(WORKFLOW_PATH, syncLabelsWorkflow(), { dryRun, overwrite: force });
  reportWriteResult(workflowResult, dryRun);

  // Seed the repoLabels block: print for manual paste when the config exists, write a new file otherwise.
  if (configExists) {
    console.info(`\n> ${CONFIG_FILE_PATH} already exists; add this block to the object passed to defineConfig:\n`);
    console.info(renderRepoLabelsBlock(scopeLabels));

    if (workflowResult.outcome === 'failed') {
      process.stderr.write('Failed to scaffold one or more files.\n');
      return 1;
    }

    console.info(`
> Next steps
  1. Paste the block above into ${CONFIG_FILE_PATH}.
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
  reportWriteResult(configResult, dryRun);

  if (workflowResult.outcome === 'failed' || configResult.outcome === 'failed') {
    process.stderr.write('Failed to scaffold one or more files.\n');
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
 * Returns `undefined` after reporting when the config cannot be loaded or validated —
 * init must not seed a label set from a config it cannot read.
 */
async function loadRetiredPackageNames(): Promise<string[] | undefined> {
  let raw: unknown;
  try {
    raw = await loadConfig();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    reportError(`Failed to load config: ${message}`);
    return undefined;
  }

  const { config, errors } = validateConfig(raw);
  if (errors.length > 0) {
    process.stderr.write('Invalid config:\n');
    for (const err of errors) {
      process.stderr.write(`  ❌ ${err}\n`);
    }
    return undefined;
  }

  return (config.retiredPackages ?? []).map((retired) => toUnscopedName(retired.name));
}

/** Strip the npm scope from a package name (`@scope/name` → `name`). */
function toUnscopedName(name: string): string {
  return name.startsWith('@') ? name.slice(name.indexOf('/') + 1) : name;
}
