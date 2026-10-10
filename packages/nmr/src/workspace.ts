import path from 'node:path';

import { findMonorepoRoot as findMonorepoRootOrNothing, resolveWorkspace } from '@williamthorsen/nmr-core/workspace';

import { UserError } from './UserError.ts';

/** The manifest whose presence marks a directory as the monorepo root. */
const WORKSPACE_MANIFEST = 'pnpm-workspace.yaml';

export type { EmptyWorkspaceCause, WorkspaceResolution } from '@williamthorsen/nmr-core/workspace';
export {
  isMonorepoRoot,
  readWorkspaceOverrides,
  readWorkspacePackageNames,
  resolveWorkspace,
} from '@williamthorsen/nmr-core/workspace';

/**
 * Finds the monorepo root by walking up from `startDir` to find `pnpm-workspace.yaml`.
 * Throws if it does not find a workspace root in `startDir` or any of its parent directories.
 */
export function findMonorepoRoot(startDir?: string): string {
  const monorepoRoot = findMonorepoRootOrNothing(startDir);

  if (monorepoRoot === undefined) {
    throw new UserError(`Could not find monorepo root: no ${WORKSPACE_MANIFEST} found in any parent directory`);
  }

  return monorepoRoot;
}

/**
 * Reads the workspace patterns from `pnpm-workspace.yaml` and resolves them to absolute package
 * directories, applying pnpm's pattern semantics, including `!`-prefixed exclusions.
 *
 * Returns an empty array when the manifest does not declare a usable `packages` list, and throws when
 * `monorepoRoot` does not contain a manifest at all.
 */
export function getWorkspacePackageDirs(monorepoRoot: string): string[] {
  const resolution = resolveWorkspace(monorepoRoot);

  if (resolution.kind === 'not-a-workspace') {
    throw new UserError(`Not a monorepo root: no ${WORKSPACE_MANIFEST} in ${monorepoRoot}`);
  }

  return resolution.kind === 'packages' ? resolution.packageDirs : [];
}

/**
 * Renders each package directory as a glob, relative to `monorepoRoot`, that matches everything beneath it, sorted. A
 * directory that is the root itself is skipped, since its glob would match the whole repo.
 */
export function toWorkspacePackageGlobs(monorepoRoot: string, packageDirs: readonly string[]): string[] {
  return packageDirs
    .map((dir) => path.relative(monorepoRoot, dir).split(path.sep).join('/'))
    .filter((relativeDir) => relativeDir !== '')
    .map((relativeDir) => `${relativeDir}/**`)
    .toSorted();
}
