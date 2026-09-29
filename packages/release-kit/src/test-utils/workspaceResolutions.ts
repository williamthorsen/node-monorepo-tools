import type { EmptyWorkspace, FailingWorkspaceCause, WorkspaceDiscovery } from '../discoverWorkspaces.ts';

/**
 * The discoveries that a mocked `discoverWorkspaces` returns, built here rather than spelled out at each mock
 * site so that a suite states which of the three situations it is exercising.
 *
 * A discovery contains the patterns from the manifest's `packages` list, which only a message quotes, so each builder
 * supplies a default rather than asking every caller to.
 */

/** A workspace declaring patterns that did not resolve to any package directory, on which every command fails. */
export function emptyWorkspace(cause: FailingWorkspaceCause, patterns: string[] = ['packages/*']): EmptyWorkspace {
  return { cause, kind: 'empty', patterns };
}

/** A workspace resolving to the given repo-relative package directories. */
export function resolvedPackages(packageDirs: string[], patterns: string[] = ['packages/*']): WorkspaceDiscovery {
  return { kind: 'packages', packageDirs, patterns };
}

/**
 * A repo that releases as one package: It does not declare a `pnpm-workspace.yaml`, or declares one that does not list
 * packages.
 */
export function singlePackage(): WorkspaceDiscovery {
  return { kind: 'single-package' };
}
