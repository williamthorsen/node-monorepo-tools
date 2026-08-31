import { describe, expect, it } from 'vitest';

import { findMisplacedTestFiles, findUntieredTestFiles, type TestFileScanOptions, TIER_NAMES } from './tiers.ts';
import { findMonorepoRoot } from './workspace.ts';

const MISPLACED_REMEDY =
  'Every test file must sit under a `__tests__` directory, the only place the shared Vitest config collects from. Move each file below into one, or name its directory in `exclude`.';

const UNTIERED_REMEDY = `Every collected test file must name its isolation tier in the segment before \`.test.\`, one of: ${TIER_NAMES.join(', ')}. Rename each file below to <subject>[.<aspect>].<tier>.test.ts.`;

/**
 * Declares a suite asserting that a repo's test files hold to nmr's conventions: every collected file names an
 * isolation tier, and every test file sits under a `__tests__` directory.
 *
 * Wire it from a one-line test of the repo's own, so the file stays under the repo's `__tests__` and the repo
 * scopes what the sweep covers. Both halves are silent without it: `unit` is the residual project, so an untiered
 * file runs and passes, and a file outside `__tests__` is collected by nothing at all.
 *
 * `exclude` names directory basenames the sweep prunes at any depth, additive to the ones nmr always prunes. Pass
 * the same array to `defineVitestConfig`'s `testCollectionExclude`, or the sweep and the collection glob describe
 * different trees: a directory pruned here alone still runs the files this suite stopped reporting.
 */
export function checkTestFileConventions(options: TestFileConventionsOptions = {}): void {
  describe('test file conventions', () => {
    const { misplaced, rootDir, untiered } = reportTestFileConventions(options);

    it('every collected test file names its tier', () => {
      expect(untiered, `${UNTIERED_REMEDY} Swept from ${rootDir}.`).toStrictEqual([]);
    });

    it('every test file sits under a __tests__ directory', () => {
      expect(misplaced, `${MISPLACED_REMEDY} Swept from ${rootDir}.`).toStrictEqual([]);
    });
  });
}

/**
 * Sweeps a repo for both halves of the convention, reporting the root it swept alongside what it found.
 *
 * The root is what makes the result trustworthy, and it is the one thing an assertion cannot check: a sweep
 * started from the directory Vitest supplies covers one package, finds nothing, and passes.
 *
 * @internal - Exported only to enable testing
 */
export function reportTestFileConventions({
  exclude,
  rootDir,
}: TestFileConventionsOptions = {}): TestFileConventionsReport {
  const sweptRoot = rootDir ?? findMonorepoRoot();
  const scanOptions: TestFileScanOptions = { ...(exclude !== undefined && { exclude }) };

  return {
    misplaced: findMisplacedTestFiles(sweptRoot, scanOptions),
    rootDir: sweptRoot,
    untiered: findUntieredTestFiles(sweptRoot, scanOptions),
  };
}

export interface TestFileConventionsOptions {
  /**
   * Directory basenames the sweep prunes at any depth, additive to the ones nmr always prunes. The array a repo
   * passes here is the array it passes to `defineVitestConfig`'s `testCollectionExclude`.
   */
  exclude?: readonly string[];

  /**
   * The directory to sweep. Defaults to the monorepo root found from the working directory, so one call covers the
   * whole repo from whichever package Vitest started in.
   */
  rootDir?: string;
}

/** What one sweep found, and the root it found it in. Paths are relative to that root and POSIX-separated. */
export interface TestFileConventionsReport {
  misplaced: string[];
  rootDir: string;
  untiered: string[];
}
