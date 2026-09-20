import type { EmptyWorkspaceCause, WorkspaceResolution } from '@williamthorsen/nmr-core/workspace';

/**
 * The resolutions a mocked `discoverWorkspaces` hands back, built here rather than spelled out at each mock
 * site so that a suite states which of the three situations it is exercising.
 *
 * A resolution carries the `packages` list the manifest declared, which only a message quotes, so each builder
 * supplies one consistent with the directories rather than asking every caller to.
 */

/** A workspace declaring patterns that resolved to no package directory, which every command fails on. */
export function emptyWorkspace(cause: EmptyWorkspaceCause, patterns: string[] = ['packages/*']): WorkspaceResolution {
  return { cause, kind: 'empty', patterns };
}

/** A directory declaring no `pnpm-workspace.yaml`, which is what selects single-package mode. */
export function notAWorkspace(): WorkspaceResolution {
  return { kind: 'not-a-workspace' };
}

/** A workspace resolving to the given repo-relative package directories. */
export function resolvedPackages(packageDirs: string[], patterns: string[] = ['packages/*']): WorkspaceResolution {
  return { kind: 'packages', packageDirs, patterns };
}
