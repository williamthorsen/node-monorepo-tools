import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const workflowsDir = join(import.meta.dirname, '..', '.github', 'workflows');

/** Read a workflow file from the .github/workflows directory. */
function readWorkflow(filename: string): string {
  return readFileSync(join(workflowsDir, filename), 'utf8');
}

// Workflows authored in this repo — callers use relative paths to their reusable counterparts.
const localCallerPairs = [
  ['release.yaml', 'release.reusable.yaml'],
  ['publish.yaml', 'publish.reusable.yaml'],
] as const;

describe('caller workflows use relative paths to reusable workflows', () => {
  it.each(localCallerPairs)('%s references %s via relative path', (caller, reusable) => {
    const content = readWorkflow(caller);

    expect(content).toContain(`uses: ./.github/workflows/${reusable}`);
  });
});

describe('reusable workflow files exist', () => {
  it.each(localCallerPairs)('%s has a corresponding reusable workflow %s', (_caller, reusable) => {
    expect(existsSync(join(workflowsDir, reusable))).toBe(true);
  });
});

// Dogfooded workflows — this repo uses the same cross-repo ref that consumers get.
describe('dogfooded caller workflows use cross-repo refs', () => {
  it('sync-labels.yaml references the cross-repo reusable workflow', () => {
    const content = readWorkflow('sync-labels.yaml');

    expect(content).toContain(
      'uses: williamthorsen/node-monorepo-tools/.github/workflows/sync-labels.reusable.yaml@sync-labels-workflow-v1',
    );
  });
});
