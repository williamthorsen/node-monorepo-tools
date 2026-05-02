/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { deriveWorkspaceConfig } from './deriveWorkspaceConfig.ts';
import { discoverWorkspaces } from './discoverWorkspaces.ts';
import type { ResolvedTag } from './resolveReleaseTags.ts';
import { resolveReleaseTags } from './resolveReleaseTags.ts';
import type { WorkspaceConfig } from './types.ts';

/**
 * Discover workspaces, resolve release tags from HEAD, validate `--tags` names against the
 * full resolved tag names (e.g., `nmr-core-v1.3.0`), and return the filtered tag list.
 * Works in both single-package and monorepo modes. Exits with an error message on any validation
 * failure — including `deriveWorkspaceConfig()` throws for workspaces missing a `package.json` `name` field.
 *
 * In both modes `deriveWorkspaceConfig` is called so `WorkspaceConfig.isPublishable` (read
 * from `package.json#private`) propagates onto each `ResolvedTag`. Single-package mode now
 * derives `./package.json`'s workspace config too — consumers that previously relied on
 * single-package mode skipping the derive step need a `name` field on `./package.json`,
 * but in practice every npm/pnpm package already has one.
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

  // Build workspace list so resolveReleaseTags can match tags by tagPrefix (derived from pkg.name)
  // and propagate isPublishable. In single-package mode, derive the single workspace config from
  // `./package.json` so its `isPublishable` reaches each ResolvedTag.
  let workspaces: WorkspaceConfig[] | undefined;
  let singleWorkspace: WorkspaceConfig | undefined;
  try {
    if (discoveredPaths === undefined) {
      singleWorkspace = deriveWorkspaceConfig('.');
    } else {
      workspaces = discoveredPaths.map((workspacePath) => deriveWorkspaceConfig(workspacePath));
    }
  } catch (error: unknown) {
    console.error(`Error resolving workspaces: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  // Resolve tags from HEAD.
  let resolvedTags = resolveReleaseTags(workspaces, singleWorkspace);

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
