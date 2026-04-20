import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { findPackageRoot } from '@williamthorsen/node-monorepo-core';

/**
 * Resolve the git-cliff configuration file path.
 *
 * Checks candidates in order: explicit `cliffConfigPath` -> `.config/git-cliff.toml` ->
 * `cliff.toml` -> bundled `cliff.toml.template`. Returns the first path that exists,
 * or throws if even the bundled template cannot be found.
 *
 * When an explicit `cliffConfigPath` is provided, it is returned as-is without checking
 * existence, preserving current behavior (git-cliff reports the error if the file is missing).
 */
export function resolveCliffConfigPath(cliffConfigPath: string | undefined, metaUrl: string): string {
  // Explicit path: return without checking existence.
  if (cliffConfigPath !== undefined) {
    return cliffConfigPath;
  }

  // Convention-based candidates in priority order.
  const candidates = ['.config/git-cliff.toml', 'cliff.toml'];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // Bundled template fallback.
  const root = findPackageRoot(metaUrl);
  const bundledPath = resolve(root, 'cliff.toml.template');
  if (existsSync(bundledPath)) {
    return bundledPath;
  }

  throw new Error(
    `Could not resolve a git-cliff config file. Searched: ${candidates.join(', ')}, and bundled template at ${bundledPath}`,
  );
}
