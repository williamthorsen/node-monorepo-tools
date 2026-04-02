import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const workflowsDir = join(import.meta.dirname, '..', '.github', 'workflows');

/** Read a workflow file from the .github/workflows directory. */
function readWorkflow(filename: string): string {
  return readFileSync(join(workflowsDir, filename), 'utf8');
}

const callerReusablePairs = [
  ['release.yaml', 'release.reusable.yaml'],
  ['publish.yaml', 'publish.reusable.yaml'],
  ['sync-labels.yaml', 'sync-labels.reusable.yaml'],
] as const;

describe('caller workflows use relative paths to reusable workflows', () => {
  it.each(callerReusablePairs)('%s references %s via relative path', (caller, reusable) => {
    const content = readWorkflow(caller);

    expect(content).toContain(`uses: ./.github/workflows/${reusable}`);
  });
});

describe('reusable workflow files exist', () => {
  it.each(callerReusablePairs)('%s has a corresponding reusable workflow %s', (_caller, reusable) => {
    expect(existsSync(join(workflowsDir, reusable))).toBe(true);
  });
});
