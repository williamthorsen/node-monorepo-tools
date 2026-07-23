import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';

import { isObject } from './helpers/type-guards.ts';

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
  const parsed: unknown = parse(content);

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

function getPackagesFromParsedYaml(parsed: unknown): string[] | undefined {
  if (!isObject(parsed)) return undefined;
  const packages = parsed.packages;
  if (!Array.isArray(packages)) return undefined;
  if (!packages.every((p): p is string => typeof p === 'string')) return undefined;
  return packages;
}
