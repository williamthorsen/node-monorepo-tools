import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { GIT_OUTPUT_LIMIT, reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { checkRetiredSyncLabelsConfig } from './retiredConfig.ts';

/** Workflow file that must exist before triggering. */
const WORKFLOW_FILE = '.github/workflows/sync-labels.yaml';

/** Checks whether the `gh` CLI is available. */
function checkGhAvailable(): boolean {
  try {
    execSync('gh --version', { maxBuffer: GIT_OUTPUT_LIMIT, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs the `sync-labels sync` subcommand, which triggers the sync-labels workflow, and returns the process exit code.
 */
export function syncLabelsCommand(): number {
  if (checkRetiredSyncLabelsConfig()) {
    return 1;
  }

  if (!checkGhAvailable()) {
    reportError('The `gh` CLI is not installed or not in PATH. Install it from https://cli.github.com/');
    return 1;
  }

  if (!existsSync(WORKFLOW_FILE)) {
    reportError(`${WORKFLOW_FILE} not found. Run \`release-kit sync-labels init\` first.`);
    return 1;
  }

  try {
    execSync('gh workflow run sync-labels.yaml', { stdio: 'inherit' });
  } catch (error: unknown) {
    const message = describeError(error);
    reportError(`Failed to trigger workflow: ${message}`);
    return 1;
  }

  console.info('Workflow triggered successfully. View runs at: gh run list --workflow=sync-labels.yaml');
  return 0;
}
