import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..');
const workflowPath = join(repoRoot, '.github/workflows/code-quality.yaml');

/** Read a file with a descriptive assertion on existence. */
function readRepoFile(path: string): string {
  expect(existsSync(path), `expected file to exist: ${path}`).toBe(true);
  return readFileSync(path, 'utf8');
}

describe('nmr kit audit config migration checks against this repo', () => {
  it('passes: no legacy .audit-ci/ directory exists', () => {
    expect(existsSync(join(repoRoot, '.audit-ci'))).toBe(false);
  });

  it('passes: code-quality workflow does not use nmr ci', () => {
    const content = readRepoFile(workflowPath);

    expect(content).not.toMatch(/check-command:\s*pnpm exec nmr ci(\s|$)/);
  });

  it('passes: code-quality workflow uses build && check:strict', () => {
    const content = readRepoFile(workflowPath);

    expect(content).toContain('pnpm exec nmr build && pnpm exec nmr check:strict');
  });
});

describe('audit-deps kit checks against this repo', () => {
  it('passes: audit-deps config exists', () => {
    expect(existsSync(join(repoRoot, '.config/audit-deps.config.json'))).toBe(true);
  });
});
