/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { basename } from 'node:path';

import { discoverWorkspaces } from './discoverWorkspaces.ts';
import type { ResolvedTag } from './resolveReleaseTags.ts';
import { resolveReleaseTags } from './resolveReleaseTags.ts';

/**
 * Discover workspaces, resolve release tags from HEAD, validate `--only` names, and return
 * the filtered tag list. Exits with an error message on any validation failure.
 */
export async function resolveCommandTags(only: string[] | undefined): Promise<ResolvedTag[]> {
  // Discover workspaces to determine single-package vs monorepo mode.
  let discoveredPaths: string[] | undefined;
  try {
    discoveredPaths = await discoverWorkspaces();
  } catch (error: unknown) {
    console.error(`Error discovering workspaces: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  if (only !== undefined && discoveredPaths === undefined) {
    console.error('Error: --only is only supported for monorepo configurations');
    process.exit(1);
  }

  // Build workspace map: dir (basename) -> workspace path.
  const workspaceMap =
    discoveredPaths === undefined ? undefined : new Map(discoveredPaths.map((p) => [basename(p), p]));

  // Resolve tags from HEAD.
  let resolvedTags = resolveReleaseTags(workspaceMap);

  if (resolvedTags.length === 0) {
    console.error('Error: No release tags found on HEAD. Create tags with `release-kit tag` first.');
    process.exit(1);
  }

  // Validate --only against resolved tags.
  if (only !== undefined) {
    const availableNames = resolvedTags.map((t) => t.dir);
    for (const name of only) {
      if (!availableNames.includes(name)) {
        console.error(`Error: Unknown package "${name}" in --only. Available: ${availableNames.join(', ')}`);
        process.exit(1);
      }
    }
    resolvedTags = resolvedTags.filter((t) => only.includes(t.dir));
  }

  return resolvedTags;
}
