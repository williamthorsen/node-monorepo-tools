/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { component } from './component.ts';
import { discoverWorkspaces } from './discoverWorkspaces.ts';
import type { ResolvedTag } from './resolveReleaseTags.ts';
import { resolveReleaseTags } from './resolveReleaseTags.ts';
import type { ComponentConfig } from './types.ts';

/**
 * Discover workspaces, resolve release tags from HEAD, validate `--tags` names against the
 * full resolved tag names (e.g., `node-monorepo-core-v1.3.0`), and return the filtered tag list.
 * Works in both single-package and monorepo modes. Exits with an error message on any validation
 * failure — including `component()` throws for workspaces missing a `package.json` `name` field.
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

  // Build component list so resolveReleaseTags can match tags by tagPrefix (derived from pkg.name).
  let components: ComponentConfig[] | undefined;
  if (discoveredPaths !== undefined) {
    try {
      components = discoveredPaths.map((workspacePath) => component(workspacePath));
    } catch (error: unknown) {
      console.error(`Error resolving workspace components: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  // Resolve tags from HEAD.
  let resolvedTags = resolveReleaseTags(components);

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
