import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';

import { readStringValues } from './helpers/readStringValues.ts';
import { isObject } from './helpers/type-guards.ts';
import { resolvePackageDirs } from './helpers/workspace-patterns.ts';
import { UserError } from './UserError.ts';

/** The manifest whose presence marks a directory as the monorepo root. */
const WORKSPACE_MANIFEST = 'pnpm-workspace.yaml';

/** Reports whether a directory is the monorepo root, which the workspace manifest's presence marks. */
export function isMonorepoRoot(dir: string): boolean {
  return existsSync(path.join(dir, WORKSPACE_MANIFEST));
}

/**
 * Finds the monorepo root by walking up from `startDir` to find `pnpm-workspace.yaml`.
 * Throws if no workspace root is found.
 */
export function findMonorepoRoot(startDir?: string): string {
  let dir = path.resolve(startDir ?? process.cwd());

  for (;;) {
    if (isMonorepoRoot(dir)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new UserError(`Could not find monorepo root: no ${WORKSPACE_MANIFEST} found in any parent directory`);
    }
    dir = parent;
  }
}

/**
 * Reads the workspace patterns from `pnpm-workspace.yaml` and resolves them to absolute package
 * directories, applying pnpm's pattern semantics — including `!`-prefixed exclusions.
 *
 * Returns an empty array when the manifest declares no usable `packages` list, and throws when
 * `monorepoRoot` holds no manifest at all — the caller named a directory that is not a monorepo root.
 */
export function getWorkspacePackageDirs(monorepoRoot: string): string[] {
  const workspaceFile = path.join(monorepoRoot, WORKSPACE_MANIFEST);

  if (!existsSync(workspaceFile)) {
    throw new UserError(`Not a monorepo root: no ${WORKSPACE_MANIFEST} in ${monorepoRoot}`);
  }

  const content = readFileSync(workspaceFile, 'utf8');
  const parsed: unknown = parse(content);

  const packages = getPackagesFromParsedYaml(parsed);

  if (!packages) {
    return [];
  }

  return resolvePackageDirs(monorepoRoot, packages);
}

/**
 * Reads the `overrides` block from the monorepo root's `pnpm-workspace.yaml`, the second site pnpm accepts an
 * override in, beside the root `package.json`'s `pnpm.overrides`.
 *
 * Returns nothing when the manifest or the block is missing, and drops an entry whose value is not a string.
 */
export function readWorkspaceOverrides(monorepoRoot: string): Record<string, string> | undefined {
  const workspaceFile = path.join(monorepoRoot, WORKSPACE_MANIFEST);

  if (!existsSync(workspaceFile)) {
    return undefined;
  }

  const parsed: unknown = parse(readFileSync(workspaceFile, 'utf8'));
  if (!isObject(parsed)) {
    return undefined;
  }

  const overrides = parsed['overrides'];

  return isObject(overrides) ? readStringValues(overrides) : undefined;
}

function getPackagesFromParsedYaml(parsed: unknown): string[] | undefined {
  if (!isObject(parsed)) return undefined;
  const packages = parsed['packages'];
  if (!Array.isArray(packages)) return undefined;
  if (!packages.every((p): p is string => typeof p === 'string')) return undefined;
  return packages;
}
