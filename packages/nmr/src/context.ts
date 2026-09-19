import path from 'node:path';

import { loadRootConfig } from './config.ts';
import type { NmrConfig } from './types.ts';
import { findMonorepoRoot, getWorkspacePackageDirs } from './workspace.ts';

export interface ResolvedContext {
  monorepoRoot: string;
  isRoot: boolean;
  packageDir?: string;
  /** The workspace's package directories, resolved once here rather than swept for again by each reader. */
  workspacePackageDirs: string[];
  config: NmrConfig;
}

/**
 * Determines whether a directory is inside a workspace package.
 * Returns the package directory if so, or `undefined` if in root context.
 *
 * A workspace may nest one package inside another, so the deepest containing directory wins — matching
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
 */
export async function resolveContext(cwd?: string): Promise<ResolvedContext> {
  const resolvedCwd = path.resolve(cwd ?? process.cwd());
  const monorepoRoot = findMonorepoRoot(resolvedCwd);
  const config = await loadRootConfig(monorepoRoot);
  const workspaceDirs = getWorkspacePackageDirs(monorepoRoot);
  const packageDir = findContainingPackageDir(resolvedCwd, workspaceDirs);

  return {
    monorepoRoot,
    isRoot: packageDir === undefined,
    ...(packageDir !== undefined && { packageDir }),
    workspacePackageDirs: workspaceDirs,
    config,
  };
}
