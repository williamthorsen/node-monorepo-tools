import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** Workflow file that must exist before triggering. */
const WORKFLOW_FILE = '.github/workflows/sync-labels.yaml';

/** Check that the `gh` CLI is available. */
function checkGhAvailable(): boolean {
  try {
    execSync('gh --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run the `sync-labels sync` subcommand.
 *
 * Validates prerequisites (gh CLI, workflow file), then triggers the sync-labels workflow
 * via `gh workflow run`. Returns 0 on success, 1 on failure.
 */
export function syncLabelsCommand(): number {
  if (!checkGhAvailable()) {
    console.error('Error: The `gh` CLI is not installed or not in PATH. Install it from https://cli.github.com/');
    return 1;
  }

  if (!existsSync(WORKFLOW_FILE)) {
    console.error(`Error: ${WORKFLOW_FILE} not found. Run \`release-kit sync-labels init\` first.`);
    return 1;
  }

  try {
    execSync('gh workflow run sync-labels.yaml', { stdio: 'inherit' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error triggering workflow: ${message}`);
    return 1;
  }

  console.info('Workflow triggered successfully. View runs at: gh run list --workflow=sync-labels.yaml');
  return 0;
}
