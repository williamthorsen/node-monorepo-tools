import path from 'node:path';

import type { NmrConfig } from './config.ts';
import { loadConfig } from './config.ts';
import { findMonorepoRoot, getWorkspacePackageDirs } from './workspace.ts';

export interface ResolvedContext {
  monorepoRoot: string;
  isRoot: boolean;
  packageDir?: string;
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
  const resolved = path.resolve(dir);
  let nearest: string | undefined;

  for (const pkgDir of workspacePackageDirs) {
    const resolvedPkgDir = path.resolve(pkgDir);
    if (resolved !== resolvedPkgDir && !resolved.startsWith(resolvedPkgDir + path.sep)) continue;
    if (nearest === undefined || resolvedPkgDir.length > nearest.length) {
      nearest = resolvedPkgDir;
    }
  }

  return nearest;
}

/**
 * Resolves the full execution context: monorepo root, whether we're in a
 * workspace package or root context, and the loaded configuration.
 */
export async function resolveContext(cwd?: string): Promise<ResolvedContext> {
  const resolvedCwd = path.resolve(cwd ?? process.cwd());
  const monorepoRoot = findMonorepoRoot(resolvedCwd);
  const config = await loadConfig(monorepoRoot);
  const workspaceDirs = getWorkspacePackageDirs(monorepoRoot);
  const packageDir = findContainingPackageDir(resolvedCwd, workspaceDirs);

  return {
    monorepoRoot,
    isRoot: packageDir === undefined,
    ...(packageDir !== undefined && { packageDir }),
    config,
  };
}
