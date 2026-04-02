import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/** Read a workflow file from the .github/workflows directory. */
function readWorkflow(filename: string): string {
  return readFileSync(join(import.meta.dirname, '..', '.github', 'workflows', filename), 'utf8');
}

describe('caller workflows use relative paths to reusable workflows', () => {
  it.each([
    ['release.yaml', 'release.reusable.yaml'],
    ['publish.yaml', 'publish.reusable.yaml'],
    ['sync-labels.yaml', 'sync-labels.reusable.yaml'],
  ])('%s references %s via relative path', (caller, reusable) => {
    const content = readWorkflow(caller);

    expect(content).toContain(`uses: ./.github/workflows/${reusable}`);
  });
});
