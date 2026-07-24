import type { GlobOptionsWithoutFileTypes } from 'node:fs';
import { globSync } from 'node:fs';
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
 * Resolves pnpm workspace patterns to absolute package directories.
 *
 * Applies pnpm's algorithm: every pattern is rewritten to match a manifest, `!`-prefixed patterns become
 * exclusions, and the matcher decides the rest. Exclusions filter the entire positive match set
 * irrespective of declaration order.
 */
export function resolvePackageDirs(monorepoRoot: string, patterns: string[]): string[] {
  const included: string[] = [];
  const excluded: string[] = [];

  for (const pattern of patterns) {
    // An unquoted `!pkg` in the manifest parses as a YAML tag rather than a string, leaving an empty
    // entry behind. Dropping it keeps that from becoming a positive pattern that matches the filesystem
    // root; the exclusion itself is already lost by then, and quoting is what preserves it.
    if (pattern.trim() === '') continue;

    const isNegated = pattern.startsWith('!');
    const target = isNegated ? excluded : included;
    target.push(toManifestPattern(isNegated ? pattern.slice(1) : pattern));
  }

  if (included.length === 0) {
    return [];
  }

  const options: GlobOptions = {
    cwd: monorepoRoot,
    exclude: [...excluded, ...ALWAYS_EXCLUDED],
    // pnpm's matcher follows symlinks, so a package directory symlinked into the workspace is a package.
    followSymlinks: true,
  };

  const matches = globSync(included, options);

  const dirs = matches.map((match) => path.dirname(path.resolve(monorepoRoot, match)));

  return [...new Set(dirs)].toSorted();
}

/** Rewrites a workspace pattern to match the manifest within it, tolerating a trailing slash. */
function toManifestPattern(pattern: string): string {
  return `${pattern.replace(/\/?$/, '')}/${MANIFEST}`;
}
