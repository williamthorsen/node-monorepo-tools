import { existsSync } from 'node:fs';
import path from 'node:path';

import { findMonorepoRoot } from '@williamthorsen/nmr-core/workspace';

/** The directory from which `release-kit` was invoked, and the repo root in which it now runs. */
export interface RepoLocation {
  invocationDir: string;
  root: string;
}

/**
 * Locates the repo root from `startDir` and makes it the process working directory.
 *
 * The root is the nearest ancestor containing `pnpm-workspace.yaml`, or else `startDir` itself when it contains a
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
/** Returns `dir` when it contains a `package.json`. */
function findSinglePackageRoot(dir: string): string | undefined {
  return existsSync(path.join(dir, 'package.json')) ? dir : undefined;
}
// endregion | Helpers
