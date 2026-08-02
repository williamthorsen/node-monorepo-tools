import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { glob } from 'glob';

export interface BuildOptions {
  entryGlobs?: string[];
  /** Adds to the effective ignore set, whether that set is the default or an `ignorePatterns` override. */
  extraIgnorePatterns?: string[];
  /** Replaces the default ignore set. */
  ignorePatterns?: string[];
  outdir?: string;
}

export const DEFAULT_ENTRY_GLOBS = ['src/**/*.ts'];

/**
 * Directories holding test scaffolding rather than shipped code, excluded from entry-point selection so a
 * package does not publish its own helpers. Deliberately not the vitest factory's `COVERAGE_EXCLUDE`: helpers
 * live in `test-utils/` precisely so they stay inside the coverage include set, so the two lists overlap
 * without converging and neither can be derived from the other.
 *
 * Ignoring a file removes it as an entry point, not from the emit. The compiler still emits whatever the
 * surviving entry points import, which is what keeps a production module that uses a helper from emitting a
 * dangling specifier. Widening this list can therefore only drop files nothing in production reaches.
 */
export const DEFAULT_IGNORE_PATTERNS = ['**/__fixtures__/**', '**/__mocks__/**', '**/__tests__/**', '**/test-utils/**'];

export const DEFAULT_OUTDIR = 'dist/esm/';

/** The digest length that separates packages sharing a hoisted `node_modules` while keeping the name readable. */
const DIGEST_LENGTH = 8;

/**
 * Reports whether the output a build of `packageDir` would produce is currently on disk. Applies the rule the
 * build applies, on the same options the build was given, so a caller probing for output and the build deciding
 * whether to rebuild cannot disagree: a package whose entry points emit nothing expects no output, and reports
 * present. Passing options the build was not given is what would make the two disagree.
 */
export async function hasBuildOutput(packageDir: string, options: BuildOptions = {}): Promise<boolean> {
  const outdir = options.outdir ?? DEFAULT_OUTDIR;
  const entryPoints = await glob(options.entryGlobs ?? DEFAULT_ENTRY_GLOBS, {
    cwd: packageDir,
    ignore: [...(options.ignorePatterns ?? DEFAULT_IGNORE_PATTERNS), ...(options.extraIgnorePatterns ?? [])],
  });

  return hasExpectedBuildOutput(packageDir, outdir, entryPoints);
}

/**
 * Reports whether the output a previous build would have produced is still on disk. Entry points that
 * emit nothing expect no output, so their absent outdir is not deleted output: a `src` tree holding only
 * declaration files, or none at all, would otherwise be reported as missing output and recompiled forever.
 * The emit is what makes an outdir, so what counts is whether any entry point emits, not how many there are.
 */
export function hasExpectedBuildOutput(packageDir: string, outdir: string, entryPoints: string[]): boolean {
  const emitsOutput = entryPoints.some((entry) => !entry.endsWith('.d.ts'));
  if (!emitsOutput) {
    return true;
  }

  const outputDir = path.resolve(packageDir, outdir);
  return existsSync(outputDir) && readdirSync(outputDir).length > 0;
}

/**
 * Returns the digest of the inputs the output currently on disk was built from, or `undefined` when the package
 * has never been built. Two packages holding the same sources report the same digest, and a package whose output
 * came from a different tree reports a different one, which is what tells a stale `dist` from a current one.
 */
export async function readBuildDigest(packageDir: string): Promise<string | undefined> {
  try {
    return await readFile(resolveBuildCachePath(packageDir), 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Resolves the absolute path of a package's build-cache file. The cache lives under the conventional
 * `node_modules/.cache/nmr-compile/` home rather than inside `dist`, so it stays git-ignored and is
 * never swept into a published tarball by any `files` convention. The home is the nearest enclosing
 * directory that already has a `node_modules` — the package's own when it has one, otherwise a hoisted
 * ancestor (e.g. the workspace root for a zero-dependency package) — which avoids materializing a
 * `node_modules` solely to hold the cache. The file name folds a digest of the absolute package path
 * into a readable base name, so packages sharing a hoisted `node_modules` never collide while the path
 * stays stable across runs for the same package.
 *
 * This duplicates `resolveCacheEntryPath` from `@williamthorsen/nmr-core`, which is deliberate and is the one
 * place here that may not be deduplicated. `cli-build.ts` is the build bootstrap: nmr-core's own `prepare` runs
 * it to build nmr-core, before nmr-core's `dist` exists, so nothing this module's import graph reaches may
 * resolve through that package.
 */
export function resolveBuildCachePath(packageDir: string): string {
  const absolutePackageDir = path.resolve(packageDir);
  const home = findNearestNodeModulesHost(absolutePackageDir) ?? absolutePackageDir;
  const digest = createHash('sha256').update(absolutePackageDir).digest('hex').slice(0, DIGEST_LENGTH);
  const key = `${path.basename(absolutePackageDir)}-${digest}.hash`;

  return path.join(home, 'node_modules', '.cache', 'nmr-compile', key);
}

// region | Helpers

/**
 * Walks up from `startDir` (inclusive) to the filesystem root, returning the first directory that
 * contains a `node_modules` entry, or `undefined` when none does.
 */
function findNearestNodeModulesHost(startDir: string): string | undefined {
  let current = startDir;
  let parent = path.dirname(current);
  while (!existsSync(path.join(current, 'node_modules'))) {
    if (parent === current) {
      return undefined;
    }
    current = parent;
    parent = path.dirname(current);
  }
  return current;
}

// endregion | Helpers
