import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { findMonorepoRoot, getWorkspacePackageDirs } from '@williamthorsen/nmr/workspace';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/** Directories that never hold a package's own tests, pruned so the walk stays cheap in a pnpm workspace. */
const PRUNED = new Set(['node_modules', 'dist', 'coverage']);

/** The directory the shared Vitest config's collection globs are all scoped to. Widening this past what Vitest
 * collects is what would let an uncollected file satisfy the guard. */
const TEST_DIR = '__tests__';

const TEST_FILE_PATTERN = /\.test\.tsx?$/;

const monorepoRoot = findMonorepoRoot(import.meta.dirname);

/**
 * Guards against a package's whole test suite silently disappearing. `passWithNoTests` means a run collecting
 * nothing exits 0, so a package whose `__tests__` directory was moved or renamed would otherwise report green.
 *
 * There is deliberately no allowlist: the first package that genuinely holds no tests should fail this and get an
 * explicit decision.
 */
describe('every workspace package holds at least one collectable test file', () => {
  const packageDirs = getWorkspacePackageDirs(monorepoRoot);

  it('finds workspace packages to check', () => {
    expect(packageDirs.length).toBeGreaterThan(0);
  });

  it.each(packageDirs.map((dir) => path.relative(monorepoRoot, dir)))('%s', (relativeDir) => {
    expect(hasTestFile(path.join(monorepoRoot, relativeDir))).toBe(true);
  });
});

describe(hasTestFile, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'nmr-presence-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('counts a test file under a __tests__ directory', () => {
    writeFixture(tmpDir, 'src/__tests__/thing.test.ts');

    expect(hasTestFile(tmpDir)).toBe(true);
  });

  // Vitest collects only from `__tests__`, so a file outside one is not a suite the guard can vouch for.
  it('ignores a test file outside a __tests__ directory', () => {
    writeFixture(tmpDir, 'src/thing.test.ts');

    expect(hasTestFile(tmpDir)).toBe(false);
  });

  it('ignores a dependency owning the only tests', () => {
    writeFixture(tmpDir, 'node_modules/dep/__tests__/thing.test.ts');

    expect(hasTestFile(tmpDir)).toBe(false);
  });
});

/**
 * Walks `dir` depth-first, returning at the first test file found inside a `__tests__` directory. Files elsewhere
 * are ignored, matching what the shared Vitest config collects.
 */
function hasTestFile(dir: string, inTestDir = false): boolean {
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (PRUNED.has(entry.name)) continue;
      if (hasTestFile(path.join(dir, entry.name), inTestDir || entry.name === TEST_DIR)) return true;
      continue;
    }
    // FIXME: See issue #545
    // eslint-disable-next-line vitest/no-conditional-tests
    if (inTestDir && TEST_FILE_PATTERN.test(entry.name)) return true;
  }
  return false;
}

/** Creates an empty file at `relativePath` under `root`, including any missing parent directories. */
function writeFixture(root: string, relativePath: string): void {
  const absolute = path.join(root, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, '');
}
