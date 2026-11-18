import path from 'node:path';

import { type GitResult, runGit, UserError } from '@williamthorsen/nmr-core';
import { findMonorepoRoot as findMonorepoRootOrNothing } from '@williamthorsen/nmr-core/workspace';

import { loadRootConfig } from './config.ts';
import type { NmrConfig } from './types.ts';
import { getWorkspacePackageDirs } from './workspace.ts';

export interface ResolvedContext {
  /** The directory from which root commands run: the pnpm workspace root, or the git toplevel outside a workspace. */
  monorepoRoot: string;
  /** Whether `monorepoRoot` contains `pnpm-workspace.yaml`. */
  hasWorkspace: boolean;
  isRoot: boolean;
  packageDir?: string;
  workspacePackageDirs: string[];
  config: NmrConfig;
}

/**
 * Determines whether a directory is inside a workspace package.
 * Returns the package directory if so, or `undefined` if in root context.
 *
 * A workspace may nest one package inside another, so the deepest containing directory wins. This matches
 * pnpm, which resolves a cwd to the package that encloses it most nearly.
 */
export function findContainingPackageDir(dir: string, workspacePackageDirs: string[]): string | undefined {
  const resolvedDir = path.resolve(dir);
  let nearestDir: string | undefined;

  for (const packageDir of workspacePackageDirs) {
    const resolvedPackageDir = path.resolve(packageDir);
    if (resolvedDir !== resolvedPackageDir && !resolvedDir.startsWith(resolvedPackageDir + path.sep)) continue;
    if (nearestDir === undefined || resolvedPackageDir.length > nearestDir.length) {
      nearestDir = resolvedPackageDir;
    }
  }

  return nearestDir;
}

/**
 * Resolves the full execution context: monorepo root, whether we're in a
 * workspace package or root context, and the loaded configuration.
 *
 * Outside a pnpm workspace, the git toplevel of `cwd` stands in as the root of a workspace without packages, so
 * that a command needing only git still runs. Throws when `cwd` is in neither.
 */
export async function resolveContext(
  cwd?: string,
  options: { findGitToplevel?: (dir: string) => GitResult<string> } = {},
): Promise<ResolvedContext> {
  const { findGitToplevel = readGitToplevel } = options;
  const resolvedCwd = path.resolve(cwd ?? process.cwd());
  const monorepoRoot = findMonorepoRootOrNothing(resolvedCwd);

  if (monorepoRoot === undefined) {
    const toplevel = resolveGitToplevel(resolvedCwd, findGitToplevel);
    return {
      monorepoRoot: toplevel,
      hasWorkspace: false,
      isRoot: true,
      workspacePackageDirs: [],
      config: await loadRootConfig(toplevel),
    };
  }

  const config = await loadRootConfig(monorepoRoot);
  const workspaceDirs = getWorkspacePackageDirs(monorepoRoot);
  const packageDir = findContainingPackageDir(resolvedCwd, workspaceDirs);

  return {
    monorepoRoot,
    hasWorkspace: true,
    isRoot: packageDir === undefined,
    ...(packageDir !== undefined && { packageDir }),
    workspacePackageDirs: workspaceDirs,
    config,
  };
}

// region | Helpers

/** Asks git for the toplevel of the repository containing `dir`. */
function readGitToplevel(dir: string): GitResult<string> {
  return runGit(['rev-parse', '--show-toplevel'], dir);
}

/** Returns the git toplevel of `cwd`, or throws a `UserError` naming both roots that the lookup did not find. */
function resolveGitToplevel(cwd: string, findGitToplevel: (dir: string) => GitResult<string>): string {
  const result = findGitToplevel(cwd);

  if (!result.ok) {
    throw new UserError(
      'nmr needs a pnpm workspace or a git repository: no pnpm-workspace.yaml in ' +
        `${cwd} or any parent directory, and ${cwd} is not inside a git repository (${result.error.trim()}).`,
    );
  }

  return result.stdout.trim();
}

// endregion | Helpers
