import type { EmptyWorkspace, FailingWorkspaceCause, WorkspaceDiscovery } from '../discoverWorkspaces.ts';

/**
 * The discoveries a mocked `discoverWorkspaces` hands back, built here rather than spelled out at each mock
 * site so that a suite states which of the three situations it is exercising.
 *
 * A discovery carries the `packages` list the manifest declared, which only a message quotes, so each builder
 * supplies one consistent with the directories rather than asking every caller to.
 */

/** A workspace declaring patterns that resolved to no package directory, which every command fails on. */
export function emptyWorkspace(cause: FailingWorkspaceCause, patterns: string[] = ['packages/*']): EmptyWorkspace {
  return { cause, kind: 'empty', patterns };
}

/** A workspace resolving to the given repo-relative package directories. */
export function resolvedPackages(packageDirs: string[], patterns: string[] = ['packages/*']): WorkspaceDiscovery {
  return { kind: 'packages', packageDirs, patterns };
}

/** A repo that releases as one package: it declares no `pnpm-workspace.yaml`, or none that lists packages. */
export function singlePackage(): WorkspaceDiscovery {
  return { kind: 'single-package' };
}
