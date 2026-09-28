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

/** The pair of directories through which a build publishes, both siblings of the emit directory. */
export interface ScratchDirs {
  previousDir: string;
  stagingDir: string;
}

export const DEFAULT_ENTRY_GLOBS = ['src/**/*.ts'];

/**
 * Directories holding test scaffolding rather than published code, excluded from entry-point selection so that a
 * package does not publish its own helpers. The list differs from the vitest factory's `COVERAGE_EXCLUDE`, which
 * leaves `test-utils/` inside the coverage include set, and neither list can be derived from the other.
 *
 * Ignoring a file removes it as an entry point, not from the emit. The compiler still emits whatever the
 * surviving entry points import, which keeps a production module that uses a helper from emitting a dangling
 * specifier. Widening this list can therefore only drop files that production code does not import.
 */
export const DEFAULT_IGNORE_PATTERNS = ['**/__fixtures__/**', '**/__mocks__/**', '**/__tests__/**', '**/test-utils/**'];

export const DEFAULT_OUTDIR = 'dist/esm/';

/** The cache in which a build stores its entries. Renaming it orphans every entry written by a previous build. */
const BUILD_CACHE_TOOL = 'nmr-compile';

/**
 * The package root of the nmr running this build, whether it was invoked through a bin, a symlink, or a source
 * layout.
 */
const SELF_DIR = findPackageRoot(import.meta.url);

/**
 * Reports whether the output that a build of `packageDir` would produce is currently on disk. Applies the build's
 * own rule, on the same options that the build was given, so a caller probing for output and the build deciding
 * whether to rebuild cannot disagree: A package whose entry points emit nothing does not expect any output, and
 * reports present. Passing options that the build was not given would make the two disagree.
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
 * Reports whether the output that a previous build would have produced is still on disk. Because entry points
 * that emit nothing do not expect any output, their absent outdir is not deleted output: A `src` tree holding
 * only declaration files, or none at all, would otherwise be reported as missing output and recompiled forever.
 * The emit creates an outdir, so the test is whether any entry point emits, not how many there are.
 */
export function hasExpectedBuildOutput(packageDir: string, outdir: string, entryPoints: string[]): boolean {
  const doesEmitOutput = entryPoints.some((entry) => !entry.endsWith('.d.ts'));
  if (!doesEmitOutput) {
    return true;
  }

  const outputDir = path.resolve(packageDir, outdir);
  return existsSync(outputDir) && readdirSync(outputDir).length > 0;
}

/**
 * Returns the digest of the inputs from which the output currently on disk was built, or `undefined` when the
 * package has never been built. Two packages containing the same sources report the same digest, and a package
 * whose output came from a different tree reports a different one, which distinguishes a stale `dist` from a
 * current one.
 */
export async function readBuildDigest(packageDir: string): Promise<string | undefined> {
  return readCacheEntry(resolveBuildCachePath(packageDir));
}

/**
 * Resolves the absolute path of a package's build-cache file, one entry in the shared store. The package
 * directory is the entry's scope, so the store keys the file to it and packages sharing a hoisted
 * `node_modules` never collide.
 *
 * Three things keep the path pointing at every previously written entry: the `.hash` extension, the
 * package's own directory name as the slug, and the absence of `discriminators`, which would otherwise be added
 * to the digest. Changing any of them leaves every entry on disk unreachable.
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
 * Resolves the two scratch directories through which a build publishes: `staging`, which the emit is written to,
 * and `previous`, which the outgoing output is renamed aside to. Both are siblings of the emit directory, so a
 * rename between them never crosses a filesystem, and both are dot-prefixed so that a leftover stays out of the
 * globs that select sources.
 *
 * The names are fixed rather than unique because the build removes both before use. A unique name would need a
 * sweep to accomplish that removal, and a sweep cannot tell a directory orphaned by a killed run from one that a
 * concurrent build is still writing. Because a directory left behind by a failed build is cleared the same way,
 * the failure path does not need any cleanup of its own.
 */
export function resolveScratchDirs(emitDir: string): ScratchDirs {
  const parent = path.dirname(emitDir);
  const name = path.basename(emitDir);

  return {
    previousDir: path.join(parent, `.${name}.previous`),
    stagingDir: path.join(parent, `.${name}.staging`),
  };
}

/**
 * Resolves the fingerprint of the nmr compiling `packageDir`, the `BuildToolchain` member that identifies nmr. It
 * is nmr's own build digest when one is on disk, which changes on a dev-loop edit that the version does not
 * follow, and nmr's package version otherwise -- the case in a consuming repo, whose installed copy was built
 * elsewhere.
 *
 * A build of nmr itself takes the version too. Its digest is the entry that the build is about to overwrite, so
 * including it would make the key a function of its own previous value, which never stops changing: nmr would
 * rebuild on every invocation and change the fingerprint that every other package reads.
 *
 * Because the fingerprint names the nmr that produced the output, not the sources in `src`, a package compiled by
 * the pre-rebuild binary keeps the old fingerprint and rebuilds on the next run.
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
 * Reports whether two paths name the same directory, comparing real paths so that a checkout accessed through a
 * symlink is recognized as the directory to which it resolves.
 */
function isSameDir(left: string, right: string): boolean {
  return resolveRealPath(left) === resolveRealPath(right);
}

/** Resolves a path to its real location, falling back to the absolute path when nothing is there to resolve. */
function resolveRealPath(dir: string): string {
  const absoluteDir = path.resolve(dir);
  try {
    return realpathSync(absoluteDir);
  } catch {
    return absoluteDir;
  }
}

// endregion | Helpers
