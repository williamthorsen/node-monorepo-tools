import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';

import { isObject } from './helpers/type-guards.ts';
import { resolvePackageDirs } from './helpers/workspace-patterns.ts';

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
 * Reads the workspace patterns from `pnpm-workspace.yaml` and resolves them to absolute package
 * directories, applying pnpm's pattern semantics — including `!`-prefixed exclusions.
 *
 * Returns an empty array when the manifest declares no usable `packages` list.
 */
export function getWorkspacePackageDirs(monorepoRoot: string): string[] {
  const workspaceFile = path.join(monorepoRoot, 'pnpm-workspace.yaml');
  const content = readFileSync(workspaceFile, 'utf8');
  const parsed: unknown = parse(content);

  const packages = getPackagesFromParsedYaml(parsed);

  if (!packages) {
    return [];
  }

  return resolvePackageDirs(monorepoRoot, packages);
}

function getPackagesFromParsedYaml(parsed: unknown): string[] | undefined {
  if (!isObject(parsed)) return undefined;
  const packages = parsed.packages;
  if (!Array.isArray(packages)) return undefined;
  if (!packages.every((p): p is string => typeof p === 'string')) return undefined;
  return packages;
}
