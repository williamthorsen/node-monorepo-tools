import { existsSync } from 'node:fs';
import path from 'node:path';

import { findMonorepoRoot } from '@williamthorsen/nmr-core/workspace';

/** The directory `release-kit` was invoked from, and the repo root it now runs in. */
export interface RepoLocation {
  invocationDir: string;
  root: string;
}

/**
 * Locates the repo root from `startDir` and makes it the process working directory.
 *
 * The root is the nearest ancestor holding `pnpm-workspace.yaml`, or else `startDir` itself when it holds a
 * `package.json`. A single-package repo is therefore found only from its own root. Throws when neither applies.
 */
export function enterRepoRoot(startDir: string = process.cwd()): RepoLocation {
  const invocationDir = path.resolve(startDir);
  const root = findMonorepoRoot(invocationDir) ?? findSinglePackageRoot(invocationDir);
  if (root === undefined) {
    throw new Error(
      `No repo root found from ${invocationDir}: expected a pnpm-workspace.yaml in it or any parent directory, ` +
        'or a package.json in it. Run release-kit from inside a monorepo or at the root of a single-package repo.',
    );
  }

  process.chdir(root);
  return { invocationDir, root };
}

// region | Helpers
/** Returns `dir` when it holds a `package.json`. */
function findSinglePackageRoot(dir: string): string | undefined {
  return existsSync(path.join(dir, 'package.json')) ? dir : undefined;
}
// endregion | Helpers
