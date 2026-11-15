import { existsSync } from 'node:fs';

import { reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { BIN } from '../bin.ts';
import { type Gh, realGh } from '../clients/gh/gh.ts';

/** Workflow file that must exist before triggering. */
const WORKFLOW_FILE = '.github/workflows/sync-labels.yaml';

/** Name by which `gh workflow run` identifies the workflow. */
const WORKFLOW_NAME = 'sync-labels.yaml';

/**
 * Runs the `sync-labels sync` subcommand, which triggers the sync-labels workflow, and returns the process exit code.
 */
export function syncLabelsCommand(gh: Gh = realGh): number {
  if (!gh.isAvailable()) {
    reportError(BIN, 'The `gh` CLI is not installed or not in PATH. Install it from https://cli.github.com/');
    return 1;
  }

  if (!existsSync(WORKFLOW_FILE)) {
    reportError(BIN, `${WORKFLOW_FILE} not found. Run \`release-kit sync-labels init\` first.`);
    return 1;
  }

  try {
    gh.runWorkflow(WORKFLOW_NAME);
  } catch (error: unknown) {
    const message = describeError(error);
    reportError(BIN, `Failed to trigger workflow: ${message}`);
    return 1;
  }

  console.info('Workflow triggered successfully. View runs at: gh run list --workflow=sync-labels.yaml');
  return 0;
}
