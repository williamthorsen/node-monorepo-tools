import { readdirSync } from 'node:fs';
import path from 'node:path';

import { listGitIgnoredPaths } from './git-ignored-paths.ts';

/**
 * The directory scope from which every project in the shared config collects. A test file outside one runs nowhere.
 */
const TEST_DIR = '__tests__';

/** Extensions that a test file can have. Defined once, so that the glob and the walk claim the same set. */
const TEST_EXTENSIONS = '{ts,tsx}';

const TEST_GLOB_PREFIX = `**/${TEST_DIR}/**`;

/** The walk's counterpart to the collection glob's suffix. */
const TEST_FILE_PATTERN = /\.test\.tsx?$/;

/** Collection patterns for the residual project, which claims every test file that the named tiers leave. */
export const ALL_TEST_PATTERNS = [`${TEST_GLOB_PREFIX}/*.test.${TEST_EXTENSIONS}`];

/** Builds the collection patterns for one tier. */
export function buildTierPatterns(tier: string): string[] {
  return [`${TEST_GLOB_PREFIX}/*.${tier}.test.${TEST_EXTENSIONS}`];
}

/**
 * Walks `rootDir` for every `*.test.ts` or `*.test.tsx` file outside a `__tests__` directory, returning paths
 * relative to it, POSIX-separated and sorted.
 *
 * The shared config's projects do not collect such a file, so it runs nowhere and reports nothing. Only a sweep of
 * the tree tells it apart from a file that runs and passes.
 */
export function findMisplacedTestFiles(rootDir: string, options: TestFileScanOptions = {}): string[] {
  return walkTestFiles(rootDir, options, true);
}

/**
 * Walks `rootDir` for every test file that the shared config's projects collect, returning paths relative to it,
 * POSIX-separated and sorted.
 *
 * A walk, because `node:fs` `globSync` does not descend into a dot-directory and does not honour any option that
 * would make it. Vitest's globber does, so the same pattern string means different things to the two: A check built
 * on the glob would report clean over every test file under a dot-directory.
 */
export function findTestFiles(rootDir: string, options: TestFileScanOptions = {}): string[] {
  return walkTestFiles(rootDir, options, false);
}

/**
 * Walks `rootDir` for every collected test file whose name does not select a tier, returning paths relative to it,
 * POSIX-separated and sorted.
 *
 * Because `unit` is the residual project, such a file runs under it and reports success: A test run cannot tell it
 * apart from a conformant file.
 */
export function findUntieredTestFiles(rootDir: string, options: TestFileScanOptions = {}): string[] {
  return findTestFiles(rootDir, options).filter((file) => !hasTierInfix(file));
}

/**
 * Reports whether a test file's name selects a tier.
 *
 * Only the dot-delimited segment immediately before `.test.` selects one, so any earlier segment is free-form
 * documentation: `scaffold.packaged.unit.test.ts` names the `unit` tier.
 */
export function hasTierInfix(filePath: string): boolean {
  const tiers: readonly string[] = TIER_NAMES;
  return tiers.includes(path.basename(filePath).split('.').at(-3) ?? '');
}

/**
 * Names of directories that do not contain any test worth collecting: dependencies, build output, and generated
 * reports.
 *
 * These and the paths that git ignores are the scope on which the collection glob and the walk must agree.
 * Over-reporting is a failure that a consumer cannot fix; under-reporting hides the violations that a conformance
 * check exists to report.
 */
export const TEST_COLLECTION_EXCLUDE = ['.git', 'coverage', 'dist', 'node_modules'];

/** Options that every sweep over a repo's test files takes. */
export interface TestFileScanOptions {
  /**
   * Directory basenames pruned at any depth, additive to `TEST_COLLECTION_EXCLUDE` and to the paths that git
   * ignores.
   *
   * Basenames rather than globs, so that a repo can pass the same array here and to the shared Vitest config's
   * `testCollectionExclude`. Vitest still runs the files in a directory pruned from the sweep alone, and the sweep
   * does not report them.
   */
  excludedBasenames?: readonly string[];
}

/**
 * The isolation ladder, ordered by the furthest thing that a test reaches. A tier names what a test reaches, never
 * how it invokes it: A test driving a compiler through its JavaScript API is `tool`, exactly as one spawning `tsc`
 * would be. Each named tier's name is also its filename infix, so `parse.tool.test.ts` is collected by the `tool`
 * project.
 */
export const TIER_NAMES = ['unit', 'tool', 'localhost', 'remote'] as const;

/** One of the four isolation tiers. */
export type TierName = (typeof TIER_NAMES)[number];

// region | Helpers

/**
 * Descends one directory, appending every test file that the context asks for to the context's own list.
 *
 * `relativeDir` is composed with `/` as it descends, so the result does not need any separator conversion.
 * `readdirSync` reports a symlinked directory as a file here, and the walk skips it, which keeps a cyclic tree from
 * hanging the walk.
 */
function collectTestFiles(dir: string, relativeDir: string, isInTestDir: boolean, context: WalkContext): void {
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;

    if (entry.isDirectory()) {
      if (context.pruned.has(entry.name) || context.ignoredPaths.has(`${relativePath}/`)) continue;
      collectTestFiles(path.join(dir, entry.name), relativePath, isInTestDir || entry.name === TEST_DIR, context);
    } else if (
      isInTestDir !== context.misplaced &&
      TEST_FILE_PATTERN.test(entry.name) &&
      !context.ignoredPaths.has(relativePath)
    ) {
      context.foundPaths.push(relativePath);
    }
  }
}

/** What one walk passes down the tree. */
interface WalkContext {
  foundPaths: string[];
  /** Paths under the walk's root that git ignores, a directory's ending in `/`. */
  ignoredPaths: ReadonlySet<string>;
  /** Keeps the test files outside a `__tests__` directory instead of the ones inside one. */
  misplaced: boolean;
  pruned: ReadonlySet<string>;
}

/**
 * Runs one walk over `rootDir` and sorts what it found.
 *
 * The two halves of the convention read the same pattern, the same prune set, and the same ignored paths, differing
 * only in which side of `__tests__` they keep, so they cannot disagree about what counts as a test file or about
 * what is out of scope.
 */
function walkTestFiles(rootDir: string, { excludedBasenames = [] }: TestFileScanOptions, misplaced: boolean): string[] {
  const context: WalkContext = {
    foundPaths: [],
    ignoredPaths: new Set(listGitIgnoredPaths(rootDir)),
    misplaced,
    pruned: new Set([...TEST_COLLECTION_EXCLUDE, ...excludedBasenames]),
  };

  collectTestFiles(rootDir, '', false, context);

  return context.foundPaths.toSorted();
}

// endregion | Helpers
