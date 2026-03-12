import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';

import type { NmrConfig } from './config.js';
import { loadConfig } from './config.js';
import { isObject } from './helpers/type-guards.js';

export interface ResolvedContext {
  monorepoRoot: string;
  isRoot: boolean;
  packageDir?: string;
  config: NmrConfig;
}

/**
 * Finds the monorepo root by walking up from `startDir` to find `pnpm-workspace.yaml`.
 * Throws if no workspace root is found.
 */
export function findMonorepoRoot(startDir?: string): string {
  let dir = path.resolve(startDir ?? process.cwd());

  for (;;) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('Could not find monorepo root: no pnpm-workspace.yaml found in any parent directory');
    }
    dir = parent;
  }
}

/**
 * Reads workspace patterns from `pnpm-workspace.yaml` and resolves them
 * to actual package directories on the filesystem.
 *
 * Handles simple glob patterns like `packages/*` by listing matching
 * subdirectories that contain a `package.json`.
 */
export function getWorkspacePackageDirs(monorepoRoot: string): string[] {
  const workspaceFile = path.join(monorepoRoot, 'pnpm-workspace.yaml');
  const content = readFileSync(workspaceFile, 'utf8');
  const parsed: unknown = yaml.load(content);

  const packages = getPackagesFromParsedYaml(parsed);

  if (!packages) {
    return [];
  }

  const dirs: string[] = [];
  for (const pattern of packages) {
    if (pattern.endsWith('/*')) {
      // Handle "packages/*" style patterns
      const prefix = pattern.slice(0, -2);
      const prefixDir = path.resolve(monorepoRoot, prefix);
      if (existsSync(prefixDir)) {
        for (const entry of readdirSync(prefixDir)) {
          const fullPath = path.join(prefixDir, entry);
          if (statSync(fullPath).isDirectory() && existsSync(path.join(fullPath, 'package.json'))) {
            dirs.push(fullPath);
          }
        }
      }
    } else if (!pattern.includes('*')) {
      // Handle exact paths like "tools/cli"
      const fullPath = path.resolve(monorepoRoot, pattern);
      if (existsSync(fullPath) && existsSync(path.join(fullPath, 'package.json'))) {
        dirs.push(fullPath);
      }
    }
    // More complex glob patterns (e.g., "packages/**") are not supported
  }

  return dirs;
}

/**
 * Determines whether a directory is inside a workspace package.
 * Returns the package directory if so, or `undefined` if in root context.
 */
export function findContainingPackageDir(dir: string, workspacePackageDirs: string[]): string | undefined {
  const resolved = path.resolve(dir);
  for (const pkgDir of workspacePackageDirs) {
    const resolvedPkgDir = path.resolve(pkgDir);
    if (resolved === resolvedPkgDir || resolved.startsWith(resolvedPkgDir + path.sep)) {
      return resolvedPkgDir;
    }
  }
  return undefined;
}

function getPackagesFromParsedYaml(parsed: unknown): string[] | undefined {
  if (!isObject(parsed)) return undefined;
  const packages = parsed.packages;
  if (!Array.isArray(packages)) return undefined;
  if (!packages.every((p): p is string => typeof p === 'string')) return undefined;
  return packages;
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
    ...(packageDir === undefined ? {} : { packageDir }),
    config,
  };
}
