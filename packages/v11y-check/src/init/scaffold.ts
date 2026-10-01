import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { findPackageRoot, writeFileWithCheck, type WriteResult } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { v11yCheckConfigTemplate } from './templates.ts';

const CONFIG_PATH = '.config/v11y-check.config.json';
export const WORKFLOW_PATH = '.github/workflows/audit.yaml';

interface ScaffoldOptions {
  dryRun: boolean;
  force: boolean;
}

interface ScaffoldResult {
  configResult: WriteResult;
}

/**
 * Scaffolds the v11y-check config file with sensible defaults, never overwriting an existing one, whose allowlist
 * `v11y sync` maintains.
 */
export function scaffoldConfig({ dryRun }: { dryRun: boolean }): ScaffoldResult {
  const configResult = writeFileWithCheck(CONFIG_PATH, v11yCheckConfigTemplate, { dryRun, overwrite: false });
  return { configResult };
}

/** Copies the bundled audit.yaml.template to `.github/workflows/audit.yaml` in the target repo. */
export function copyWorkflowTemplate(dryRun: boolean, overwrite: boolean): WriteResult {
  const template = readWorkflowTemplate();
  if ('error' in template) {
    return { filePath: WORKFLOW_PATH, outcome: 'failed', error: template.error };
  }

  return writeFileWithCheck(WORKFLOW_PATH, template.content, { dryRun, overwrite });
}

/** Reads the bundled audit.yaml.template, returning a description of the failure when it cannot. */
export function readWorkflowTemplate(): { content: string } | { error: string } {
  let root: string;
  try {
    root = findPackageRoot(import.meta.url);
  } catch (error: unknown) {
    return { error: `Failed to resolve package root: ${describeError(error)}` };
  }
  const templatePath = resolve(root, 'templates', 'audit.yaml.template');

  try {
    return { content: readFileSync(templatePath, 'utf8') };
  } catch (error: unknown) {
    return { error: `Failed to read bundled template at ${templatePath}: ${describeError(error)}` };
  }
}

/** Scaffolds the GitHub Actions audit workflow to `.github/workflows/audit.yaml`. */
export function scaffoldWorkflow(dryRun: boolean, overwrite: boolean): WriteResult {
  return copyWorkflowTemplate(dryRun, overwrite);
}

/**
 * Scaffolds the config file and the GitHub Actions workflow, returning their write results in that order. `force`
 * overwrites the workflow alone; an existing config is never overwritten.
 */
export function scaffoldFiles({ dryRun, force }: ScaffoldOptions): WriteResult[] {
  const { configResult } = scaffoldConfig({ dryRun });
  const workflowResult = scaffoldWorkflow(dryRun, force);
  return [configResult, workflowResult];
}
