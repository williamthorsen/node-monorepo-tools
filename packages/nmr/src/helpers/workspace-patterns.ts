import { type GlobOptionsWithoutFileTypes, globSync } from 'node:fs';
import path from 'node:path';

/**
 * `followSymlinks` reached Node in v24.16.0, which this package's `engines` requires, but @types/node
 * does not declare it yet (24.13.3 is the latest release). Drop the intersection once it does.
 */
type GlobOptions = GlobOptionsWithoutFileTypes & { followSymlinks?: boolean };

/**
 * The manifest that marks a directory as a package. pnpm also recognizes `package.yaml` and
 * `package.json5`; nmr recognizes only this one.
 */
const MANIFEST = 'package.json';

/** Excluded unconditionally, as pnpm's own package finder excludes it. */
const ALWAYS_EXCLUDED = ['**/node_modules/**'];

/**
 * The manifest patterns a declared `packages` list resolves to, split by what each entry asks of the matcher.
 *
 * Held as manifest patterns rather than as the entries themselves, so a caller re-matching a subset spends the
 * same rewriting a full resolution does.
 */
export interface WorkspacePatternSplit {
  excludedPatterns: string[];
  includedPatterns: string[];
}

/**
 * Matches manifest patterns against a monorepo root, returning the absolute directories that hold a matched
 * manifest, sorted and free of duplicates.
 *
 * Takes the exclusion set as an argument of its own, so a caller diagnosing an empty resolution can re-match
 * the positive patterns alone and learn whether the exclusions are what emptied it.
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
export function resolvePackageDirs(monorepoRoot: string, patterns: string[]): string[] {
  const { excludedPatterns, includedPatterns } = splitWorkspacePatterns(patterns);

  if (includedPatterns.length === 0) {
    return [];
  }

  return matchPackageDirs(monorepoRoot, includedPatterns, excludedPatterns);
}

/**
 * Splits a declared `packages` list into the manifest patterns the matcher includes and the ones it excludes.
 *
 * The sole reader of what counts as a positive pattern, shared by a resolution and by a diagnosis of its empty
 * result: two readers classifying entries separately could disagree about which condition a manifest is in.
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
    target.push(toManifestPattern(isNegated ? pattern.slice(1) : pattern));
  }

  return { excludedPatterns, includedPatterns };
}

/** Rewrites a workspace pattern to match the manifest within it, tolerating a trailing slash. */
function toManifestPattern(pattern: string): string {
  return `${pattern.replace(/\/?$/, '')}/${MANIFEST}`;
}
