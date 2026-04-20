import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Walk up from `startDir` until a directory containing `pnpm-workspace.yaml` is found.
 *
 * Mirrors the monorepo-root resolution used by `@williamthorsen/nmr`'s `findMonorepoRoot`.
 * Kept inline here to avoid a test-only cross-package dependency.
 */
function findMonorepoRoot(startDir: string): string {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('Could not find monorepo root: no pnpm-workspace.yaml found in any parent directory');
    }
    dir = parent;
  }
}

describe('audit.yaml template consistency', () => {
  it('bundled template is byte-identical to the repo workflow', () => {
    const monorepoRoot = findMonorepoRoot(dirname(fileURLToPath(import.meta.url)));
    const templatePath = resolve(monorepoRoot, 'packages/audit-deps/templates/audit.yaml.template');
    const workflowPath = resolve(monorepoRoot, '.github/workflows/audit.yaml');

    const templateContent = readFileSync(templatePath, 'utf8');
    const workflowContent = readFileSync(workflowPath, 'utf8');

    expect(templateContent, 'To reconcile, run `audit-deps init --force` or manually sync the template file.').toBe(
      workflowContent,
    );
  });
});
