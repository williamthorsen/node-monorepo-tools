import { readdirSync } from 'node:fs';
import path from 'node:path';

/** The directory scope every project in the shared config collects from. A test file outside one runs nowhere. */
const TEST_DIR = '__tests__';

/** Extensions a test file can carry. Held once, so the glob and the walk claim the same set. */
const TEST_EXTENSIONS = '{ts,tsx}';

const TEST_GLOB_PREFIX = `**/${TEST_DIR}/**`;

/** The walk's counterpart to the collection glob's suffix. */
const TEST_FILE_PATTERN = /\.test\.tsx?$/;

/** Collection patterns for the residual project, which claims every test file the named tiers leave. */
export const ALL_TEST_PATTERNS = [`${TEST_GLOB_PREFIX}/*.test.${TEST_EXTENSIONS}`];

/** Builds the collection patterns for one tier. */
export function buildTierPatterns(tier: string): string[] {
  return [`${TEST_GLOB_PREFIX}/*.${tier}.test.${TEST_EXTENSIONS}`];
}

/**
 * Walks `rootDir` for every `*.test.ts` or `*.test.tsx` file sitting outside a `__tests__` directory, returning
 * paths relative to it, POSIX-separated and sorted.
 *
 * No project collects such a file, so it runs nowhere and reports nothing. Only a sweep of the tree tells it apart
 * from a file that runs and passes.
 */
export function findMisplacedTestFiles(rootDir: string, options: TestFileScanOptions = {}): string[] {
  return walkTestFiles(rootDir, options, true);
}

/**
 * Walks `rootDir` for every test file the shared config's projects collect, returning paths relative to it,
 * POSIX-separated and sorted.
 *
 * A walk, because `node:fs` `globSync` does not descend into a dot-directory and honours no option that would make
 * it. Vitest's globber does, so the same pattern string means different things to the two: a check built on the glob
 * would report clean over every test file under a dot-directory.
 */
export function findTestFiles(rootDir: string, options: TestFileScanOptions = {}): string[] {
  return walkTestFiles(rootDir, options, false);
}

/**
 * Walks `rootDir` for every collected test file whose name selects no tier, returning paths relative to it,
 * POSIX-separated and sorted.
 *
 * `unit` is the residual project, so such a file runs under it and reports success: no test run tells it apart from
 * a conformant file.
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
 * Directory names that hold no test worth collecting: dependencies, build output, and generated reports.
 *
 * The one point where the collection glob and the walk must agree about scope. Over-reporting is a failure a
 * consumer cannot fix; under-reporting is the silence a conformance check exists to end.
 */
export const TEST_COLLECTION_EXCLUDE = ['.git', 'coverage', 'dist', 'node_modules'];

/** Options every sweep over a repo's test files takes. */
export interface TestFileScanOptions {
  /**
   * Directory basenames pruned at any depth, additive to `TEST_COLLECTION_EXCLUDE`.
   *
   * Basenames rather than globs, so the array a repo passes here is the array it passes to the shared Vitest
   * config's `testCollectionExclude`. A directory pruned from the sweep but still collected by Vitest is the
   * silence these sweeps exist to end.
   */
  exclude?: readonly string[];
}

/**
 * The isolation ladder, ordered by the furthest thing a test reaches. A tier names what a test reaches, never how it
 * invokes it: a test driving a compiler through its JavaScript API is `tool`, exactly as one spawning `tsc` would be.
 * Each named tier's name is also its filename infix, so `parse.tool.test.ts` lands in `tool`.
 */
export const TIER_NAMES = ['unit', 'tool', 'localhost', 'remote'] as const;

/** One of the four isolation tiers. */
export type TierName = (typeof TIER_NAMES)[number];

// region | Helpers

/**
 * Descends one directory, appending every test file the context asks for to the context's own list.
 *
 * `relativeDir` is composed with `/` as it descends, so the result needs no separator conversion. A symlinked
 * directory reports as a file here and is skipped, which is what keeps a cyclic tree from hanging the walk.
 */
function collectTestFiles(dir: string, relativeDir: string, inTestDir: boolean, context: WalkContext): void {
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;

    if (entry.isDirectory()) {
      if (context.pruned.has(entry.name)) continue;
      collectTestFiles(path.join(dir, entry.name), relativePath, inTestDir || entry.name === TEST_DIR, context);
    } else if (inTestDir !== context.misplaced && TEST_FILE_PATTERN.test(entry.name)) {
      context.found.push(relativePath);
    }
  }
}

/** What one walk carries down the tree. */
interface WalkContext {
  found: string[];
  /** Keeps the test files outside a `__tests__` directory instead of the ones inside one. */
  misplaced: boolean;
  pruned: ReadonlySet<string>;
}

/**
 * Runs one walk over `rootDir` and sorts what it found.
 *
 * The two halves of the convention read the same pattern and the same prune set, differing only in which side of
 * `__tests__` they keep, so they cannot disagree about what counts as a test file or about what is out of scope.
 */
function walkTestFiles(rootDir: string, { exclude = [] }: TestFileScanOptions, misplaced: boolean): string[] {
  const context: WalkContext = {
    found: [],
    misplaced,
    pruned: new Set([...TEST_COLLECTION_EXCLUDE, ...exclude]),
  };

  collectTestFiles(rootDir, '', false, context);

  return context.found.toSorted();
}

// endregion | Helpers
