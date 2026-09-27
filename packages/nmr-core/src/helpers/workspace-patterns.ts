import { type GlobOptionsWithoutFileTypes, globSync } from 'node:fs';
import path from 'node:path';

/**
 * Declares `followSymlinks`, which Node supports from v24.16.0, the version that this package's `engines`
 * requires, but which `@types/node` does not declare. Drop the intersection once it does.
 */
type GlobOptions = GlobOptionsWithoutFileTypes & { followSymlinks?: boolean };

/**
 * The manifest that marks a directory as a package. pnpm also recognizes `package.yaml` and
 * `package.json5`; nmr-core recognizes only this one.
 */
const MANIFEST = 'package.json';

/** Excluded unconditionally, as pnpm's own package finder excludes it. */
const ALWAYS_EXCLUDED = ['**/node_modules/**'];

/**
 * The manifest patterns that a declared `packages` list resolves to, split by what each entry asks of the matcher.
 *
 * Each entry is already rewritten to match a manifest, so that a caller re-matching a subset applies the same
 * rewriting as a full resolution.
 */
export interface WorkspacePatternSplit {
  excludedPatterns: string[];
  includedPatterns: string[];
}

/**
 * Matches manifest patterns against a monorepo root, returning the absolute directories that hold a matched
 * manifest, sorted and free of duplicates.
 */
export function matchPackageDirs(
  monorepoRoot: string,
  includedPatterns: readonly string[],
  excludedPatterns: readonly string[],
): string[] {
  const options: GlobOptions = {
    cwd: monorepoRoot,
    exclude: [...excludedPatterns, ...ALWAYS_EXCLUDED],
    // pnpm's matcher follows symlinks, so a package directory symlinked into the workspace is a package.
    followSymlinks: true,
  };

  const matches = globSync([...includedPatterns], options);

  const dirs = matches.map((match) => path.dirname(path.resolve(monorepoRoot, match)));

  return [...new Set(dirs)].toSorted();
}

/**
 * Resolves pnpm workspace patterns to absolute package directories.
 *
 * Applies pnpm's algorithm: every pattern is rewritten to match a manifest, `!`-prefixed patterns become
 * exclusions, and the matcher decides the rest. Exclusions filter the entire positive match set
 * irrespective of declaration order.
 */
export function resolvePackageDirs(monorepoRoot: string, patterns: readonly string[]): string[] {
  const { excludedPatterns, includedPatterns } = splitWorkspacePatterns(patterns);

  if (includedPatterns.length === 0) {
    return [];
  }

  return matchPackageDirs(monorepoRoot, includedPatterns, excludedPatterns);
}

/**
 * Splits a declared `packages` list into the manifest patterns that the matcher includes and the ones that it
 * excludes. A resolution and the diagnosis of its empty result both classify entries here, so that they agree.
 */
export function splitWorkspacePatterns(patterns: readonly string[]): WorkspacePatternSplit {
  const includedPatterns: string[] = [];
  const excludedPatterns: string[] = [];

  for (const pattern of patterns) {
    // An unquoted `!pkg` in the manifest parses as a YAML tag rather than a string, leaving an empty
    // entry behind. Dropping it keeps that from becoming a positive pattern that matches the filesystem
    // root; the exclusion itself is already lost by then, and quoting is what preserves it.
    if (pattern.trim() === '') continue;

    const isNegated = pattern.startsWith('!');
    const target = isNegated ? excludedPatterns : includedPatterns;
    target.push(buildManifestPattern(isNegated ? pattern.slice(1) : pattern));
  }

  return { excludedPatterns, includedPatterns };
}

// region | Helpers

/** Rewrites a workspace pattern to match the manifest within it, tolerating a trailing slash. */
function buildManifestPattern(pattern: string): string {
  return `${pattern.replace(/\/?$/, '')}/${MANIFEST}`;
}

// endregion | Helpers
