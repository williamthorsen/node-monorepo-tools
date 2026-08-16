import { existsSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { findPackageRoot, readCacheEntry, resolveCacheEntryPath } from '@williamthorsen/nmr-core';
import { glob } from 'glob';

import { readPackageJson } from '../helpers/package-json.ts';

export interface BuildOptions {
  entryGlobs?: string[];
  /** Adds to the effective ignore set, whether that set is the default or an `ignorePatterns` override. */
  extraIgnorePatterns?: string[];
  /** Replaces the default ignore set. */
  ignorePatterns?: string[];
  outdir?: string;
}

/** The pair of directories a build publishes through, both siblings of the emit directory. */
export interface ScratchDirs {
  previous: string;
  staging: string;
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

/** The cache a build's entries live in. Renaming it orphans every entry a previous build wrote. */
const BUILD_CACHE_TOOL = 'nmr-compile';

/** The package root of the nmr running this build, whatever bin, symlink, or source layout it was reached through. */
const SELF_DIR = findPackageRoot(import.meta.url);

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
  return readCacheEntry(resolveBuildCachePath(packageDir));
}

/**
 * Resolves the absolute path of a package's build-cache file, one entry in the shared store. The package
 * directory is the entry's scope, so the store keys the file to it and packages sharing a hoisted
 * `node_modules` never collide.
 *
 * Three things hold the path where every previously written entry already sits: the `.hash` extension, the
 * package's own directory name as the slug, and the absence of `discriminators`, which would otherwise fold
 * into the digest. Changing any of them strands every entry on disk.
 */
export function resolveBuildCachePath(packageDir: string): string {
  const absolutePackageDir = path.resolve(packageDir);

  return resolveCacheEntryPath({
    tool: BUILD_CACHE_TOOL,
    scopeDir: absolutePackageDir,
    slug: path.basename(absolutePackageDir),
    extension: '.hash',
  });
}

/**
 * Resolves the two scratch directories a build publishes through: `staging`, which the emit is written to, and
 * `previous`, which the outgoing output is renamed aside to. Both are siblings of the emit directory, so a
 * rename between them never crosses a filesystem, and both are dot-prefixed so a leftover stays out of the
 * globs that select sources.
 *
 * The names are fixed rather than unique because the build removes both before use. That removal is what a
 * unique name would need a sweep to accomplish, and a sweep cannot tell a directory orphaned by a killed run
 * from one a concurrent build is still writing. A directory left behind by a failed build is cleared the same
 * way, so the failure path needs no cleanup of its own.
 */
export function resolveScratchDirs(emitDir: string): ScratchDirs {
  const parent = path.dirname(emitDir);
  const name = path.basename(emitDir);

  return {
    previous: path.join(parent, `.${name}.previous`),
    staging: path.join(parent, `.${name}.staging`),
  };
}

/**
 * Resolves the fingerprint of the nmr compiling `packageDir`, which joins the build digest beside the compiler
 * version: the same sources emit differently across nmr versions as they do across TypeScript versions. It is
 * nmr's own build digest where one is on disk, which is what moves on a dev-loop edit the version does not
 * follow, and nmr's package version otherwise -- the case in a consuming repo, whose installed copy was built
 * elsewhere.
 *
 * A build of nmr itself takes the version too. Its digest is the entry that build is about to overwrite, so
 * folding it would make the key a function of its own previous value, which never settles: nmr would rebuild on
 * every invocation and move the fingerprint every other package reads.
 *
 * What the fingerprint names is the nmr that produced the output, not the sources sitting in `src`, so a package
 * the pre-rebuild binary compiled keeps the old fingerprint and rebuilds on the run after.
 */
export async function resolveToolchainFingerprint(packageDir: string, selfDir: string = SELF_DIR): Promise<string> {
  if (!isSameDir(packageDir, selfDir)) {
    const digest = await readBuildDigest(selfDir);
    if (digest !== undefined) {
      return digest;
    }
  }

  return readPackageJson(selfDir).version ?? '';
}

// region | Helpers

/**
 * Reports whether two paths name the same directory, comparing real paths so a checkout reached through a
 * symlink is recognized as the directory it resolves to.
 */
function isSameDir(left: string, right: string): boolean {
  return toRealPath(left) === toRealPath(right);
}

/** Resolves a path to its real location, falling back to the absolute path when nothing is there to resolve. */
function toRealPath(dir: string): string {
  const absolute = path.resolve(dir);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

// endregion | Helpers
