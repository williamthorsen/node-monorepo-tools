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
 * Walks `rootDir` for every test file the shared config's projects collect, returning paths relative to it,
 * POSIX-separated and sorted.
 *
 * A walk, because `node:fs` `globSync` does not descend into a dot-directory and honours no option that would make
 * it. Vitest's globber does, so the same pattern string means different things to the two: a check built on the glob
 * would report clean over every test file under a dot-directory.
 */
export function findTestFiles(rootDir: string): string[] {
  const found: string[] = [];
  collectTestFiles(rootDir, '', false, found);
  return found.toSorted();
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
 * Descends one directory, appending every collected test file's path to `found`.
 *
 * `relativeDir` is composed with `/` as it descends, so the result needs no separator conversion. A symlinked
 * directory reports as a file here and is skipped, which is what keeps a cyclic tree from hanging the walk.
 */
function collectTestFiles(dir: string, relativeDir: string, inTestDir: boolean, found: string[]): void {
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;

    if (entry.isDirectory()) {
      if (TEST_COLLECTION_EXCLUDE.includes(entry.name)) continue;
      collectTestFiles(path.join(dir, entry.name), relativePath, inTestDir || entry.name === TEST_DIR, found);
    } else if (inTestDir && TEST_FILE_PATTERN.test(entry.name)) {
      found.push(relativePath);
    }
  }
}

// endregion | Helpers
