import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { glob } from 'glob';
import { load } from 'js-yaml';

import { isRecord } from './typeGuards.ts';

/**
 * Reads `pnpm-workspace.yaml` and resolves its `packages` globs to discover workspace directories.
 *
 * Returns an array of workspace-relative directory paths (e.g., `['packages/arrays', 'packages/strings']`).
 * Only directories containing a `package.json` are included.
 *
 * Note: The returned paths are full relative paths from the repo root (e.g., `packages/arrays`,
 * `libs/core`). These paths are passed directly to `deriveWorkspaceConfig()`, which uses them for all
 * file path construction and derives the display name via `path.basename()`.
 *
 * @returns The discovered workspace paths, or `undefined` if no workspace config is found.
 */
export async function discoverWorkspaces(): Promise<string[] | undefined> {
  const workspaceFile = 'pnpm-workspace.yaml';

  if (!existsSync(workspaceFile)) {
    return undefined;
  }

  let content: string;
  try {
    content = readFileSync(workspaceFile, 'utf8');
  } catch (error: unknown) {
    console.warn(`Warning: Failed to read ${workspaceFile}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }

  const parsed = load(content);
  if (!isRecord(parsed)) {
    return undefined;
  }

  const packagesField = parsed.packages;
  if (!Array.isArray(packagesField)) {
    return undefined;
  }

  const patterns = packagesField.filter((p): p is string => typeof p === 'string');
  if (patterns.length === 0) {
    return undefined;
  }

  // Resolve globs to find directories
  const directories: string[] = [];

  for (const pattern of patterns) {
    const matches = await glob(pattern, { posix: true });
    for (const match of matches) {
      if (existsSync(join(match, 'package.json'))) {
        directories.push(match);
      }
    }
  }

  // eslint-disable-next-line unicorn/no-array-sort -- toSorted requires Node 20+; engine target is >=18.17.0
  return directories.length > 0 ? [...directories].sort() : undefined;
}
