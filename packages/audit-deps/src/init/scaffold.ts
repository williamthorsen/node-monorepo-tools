import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { WriteResult } from '@williamthorsen/nmr-core';
import { findPackageRoot, writeFileWithCheck } from '@williamthorsen/nmr-core';

import { auditDepsConfigTemplate } from './templates.ts';

const CONFIG_PATH = '.config/audit-deps.config.json';
const WORKFLOW_PATH = '.github/workflows/audit.yaml';

interface ScaffoldOptions {
  dryRun: boolean;
  force: boolean;
}

interface ScaffoldResult {
  configResult: WriteResult;
}

/**
 * Scaffold the audit-deps config file with sensible defaults.
 *
 * Returns `{ configResult }` to preserve the signature consumed by `syncCommand`, which predates
 * the workflow scaffolding and treats the config result as a named field.
 */
export function scaffoldConfig({ dryRun, force }: ScaffoldOptions): ScaffoldResult {
  const configResult = writeFileWithCheck(CONFIG_PATH, auditDepsConfigTemplate, { dryRun, overwrite: force });
  return { configResult };
}

/** Copy the bundled audit.yaml.template to `.github/workflows/audit.yaml` in the target repo. */
export function copyWorkflowTemplate(dryRun: boolean, overwrite: boolean): WriteResult {
  let root: string;
  try {
    root = findPackageRoot(import.meta.url);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { filePath: WORKFLOW_PATH, outcome: 'failed', error: `Failed to resolve package root: ${message}` };
  }
  const templatePath = resolve(root, 'templates', 'audit.yaml.template');

  if (!existsSync(templatePath)) {
    return { filePath: WORKFLOW_PATH, outcome: 'failed', error: `Could not find bundled template at ${templatePath}` };
  }

  let content: string;
  try {
    content = readFileSync(templatePath, 'utf8');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { filePath: WORKFLOW_PATH, outcome: 'failed', error: `Failed to read template ${templatePath}: ${message}` };
  }

  return writeFileWithCheck(WORKFLOW_PATH, content, { dryRun, overwrite });
}

/**
 * Scaffold the GitHub Actions audit workflow to `.github/workflows/audit.yaml`.
 *
 * Wraps `copyWorkflowTemplate` to provide a stable seam for future post-write transformations
 * (e.g., variable substitution) without changing call sites.
 */
export function scaffoldWorkflow(dryRun: boolean, overwrite: boolean): WriteResult {
  return copyWorkflowTemplate(dryRun, overwrite);
}

/**
 * Scaffold audit-deps files for the target repo.
 *
 * Writes both the config file and the GitHub Actions workflow. Returns a flat array of write
 * results in the order [config, workflow]. `ScaffoldOptions.force` is translated to `overwrite`
 * when calling the workflow helpers.
 */
export function scaffoldFiles({ dryRun, force }: ScaffoldOptions): WriteResult[] {
  const { configResult } = scaffoldConfig({ dryRun, force });
  const workflowResult = scaffoldWorkflow(dryRun, force);
  return [configResult, workflowResult];
}
