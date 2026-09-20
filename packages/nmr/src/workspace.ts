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
 * Throws if no workspace root is found.
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
 * directories, applying pnpm's pattern semantics — including `!`-prefixed exclusions.
 *
 * Returns an empty array when the manifest declares no usable `packages` list, and throws when
 * `monorepoRoot` holds no manifest at all — the caller named a directory that is not a monorepo root.
 */
export function getWorkspacePackageDirs(monorepoRoot: string): string[] {
  const resolution = resolveWorkspace(monorepoRoot);

  if (resolution.kind === 'not-a-workspace') {
    throw new UserError(`Not a monorepo root: no ${WORKSPACE_MANIFEST} in ${monorepoRoot}`);
  }

  return resolution.kind === 'packages' ? resolution.packageDirs : [];
}
