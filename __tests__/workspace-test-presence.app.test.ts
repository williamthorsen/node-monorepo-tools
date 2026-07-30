import { readdirSync } from 'node:fs';
import path from 'node:path';

import { findMonorepoRoot, getWorkspacePackageDirs } from '@williamthorsen/nmr/workspace';
import { describe, expect, it } from 'vitest';

/** Directories that never hold a package's own tests, pruned so the walk stays cheap in a pnpm workspace. */
const PRUNED = new Set(['node_modules', 'dist', 'coverage']);

const TEST_FILE_PATTERN = /\.test\.tsx?$/;

const monorepoRoot = findMonorepoRoot(import.meta.dirname);

/**
 * Guards against a package's whole test suite silently disappearing. `passWithNoTests` means a run collecting
 * nothing exits 0, so a package whose `__tests__` directory was moved or renamed would otherwise report green.
 *
 * There is deliberately no allowlist: the first package that genuinely holds no tests should fail this and get an
 * explicit decision.
 */
describe('every workspace package holds at least one test file', () => {
  const packageDirs = getWorkspacePackageDirs(monorepoRoot);

  it('finds workspace packages to check', () => {
    expect(packageDirs.length).toBeGreaterThan(0);
  });

  it.each(packageDirs.map((dir) => path.relative(monorepoRoot, dir)))('%s', (relativeDir) => {
    expect(hasTestFile(path.join(monorepoRoot, relativeDir))).toBe(true);
  });
});

/** Walks `dir` depth-first, returning as soon as a test file is found. */
function hasTestFile(dir: string): boolean {
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (PRUNED.has(entry.name)) continue;
      if (hasTestFile(path.join(dir, entry.name))) return true;
      continue;
    }
    if (TEST_FILE_PATTERN.test(entry.name)) return true;
  }
  return false;
}
