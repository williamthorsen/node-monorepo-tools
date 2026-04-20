/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { basename } from 'node:path';

import { discoverWorkspaces } from './discoverWorkspaces.ts';
import type { ResolvedTag } from './resolveReleaseTags.ts';
import { resolveReleaseTags } from './resolveReleaseTags.ts';

/**
 * Discover workspaces, resolve release tags from HEAD, validate `--tags` names against the
 * full resolved tag names (e.g., `core-v1.3.0`), and return the filtered tag list. Works in
 * both single-package and monorepo modes. Exits with an error message on any validation failure.
 */
export async function resolveCommandTags(tags: string[] | undefined): Promise<ResolvedTag[]> {
  // Discover workspaces to determine single-package vs monorepo mode.
  let discoveredPaths: string[] | undefined;
  try {
    discoveredPaths = await discoverWorkspaces();
  } catch (error: unknown) {
    console.error(`Error discovering workspaces: ${error instanceof Error ? error.message : String(error)}`);
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

  // Validate --tags against resolved tag names (full tag name, not dir).
  if (tags !== undefined) {
    const availableTagNames = resolvedTags.map((t) => t.tag);
    for (const name of tags) {
      if (!availableTagNames.includes(name)) {
        console.error(`Error: Unknown tag "${name}" in --tags. Available: ${availableTagNames.join(', ')}`);
        process.exit(1);
      }
    }
    resolvedTags = resolvedTags.filter((t) => tags.includes(t.tag));
  }

  return resolvedTags;
}
