/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import type { ReleaseKitConfig } from './configSchema.ts';
import { deriveWorkspaceConfig } from './deriveWorkspaceConfig.ts';
import { describeEmptyWorkspace, discoverWorkspaces, type WorkspaceDiscovery } from './discoverWorkspaces.ts';
import { formatExcludedSkip } from './formatExcludedSkip.ts';
import { readRootPackageVersion } from './loadConfig.ts';
import { mergeMonorepoConfig } from './mergeConfig.ts';
import { type ResolvedTag, resolveReleaseTags } from './resolveReleaseTags.ts';
import type { DirectoryConfig, ResolvedProjectConfig, WorkspaceConfig } from './types.ts';

/**
 * Discovers workspaces, resolves release tags from HEAD, validates `--tags` names against the full resolved tag
 * names (e.g., `nmr-core-v1.3.0`), and returns the filtered tag list. Exits with an error message on any validation
 * failure, including a workspace whose `package.json` does not have a `name` field, a config that
 * `mergeMonorepoConfig` rejects, and a workspace that does not resolve to any package, which is not single-package
 * mode.
 *
 * In monorepo mode the workspace list is `userConfig` merged over the discovered workspaces, as `prepare` builds it,
 * and each directory target and a declared composite (a `project` block or a `releases` composite) contribute their
 * `tagPrefix`, so that their tags resolve alongside them.
 * A tag on HEAD whose workspace the config excludes still counts as a tag on HEAD, so `--tags` may name it and a
 * HEAD whose tags are all excluded returns an empty list rather than failing. Each excluded tag that the run
 * selects, every one without `--tags` or the named ones with it, is dropped with a warning.
 * Single-package mode ignores `userConfig`.
 *
 * In both modes the workspace configs come from `deriveWorkspaceConfig`, so that `WorkspaceConfig.isPublishable`
 * (read from `package.json#private`) propagates onto each `ResolvedTag`.
 */
export function resolveCommandTags(
  tags: string[] | undefined,
  userConfig: ReleaseKitConfig | undefined,
): ResolvedTag[] {
  // Discover workspaces to determine single-package vs monorepo mode.
  let workspace: WorkspaceDiscovery;
  try {
    workspace = discoverWorkspaces();
  } catch (error: unknown) {
    reportError(`Failed to discover workspaces: ${describeError(error)}`);
    process.exit(1);
  }

  if (workspace.kind === 'empty') {
    reportError(`No workspace package to tag. ${describeEmptyWorkspace(workspace)}`);
    process.exit(1);
  }

  let workspaces: WorkspaceConfig[] | undefined;
  let directories: DirectoryConfig[] = [];
  let project: ResolvedProjectConfig | undefined;
  let singleWorkspace: WorkspaceConfig | undefined;
  let excludedPaths = new Set<string>();
  try {
    if (workspace.kind === 'single-package') {
      singleWorkspace = deriveWorkspaceConfig('.');
    } else {
      const mergedConfig = mergeMonorepoConfig(workspace.packageDirs, userConfig, readRootPackageVersion());
      const excludedWorkspaces = mergedConfig.excludedWorkspaces ?? [];
      // Excluded workspaces stay in the match set so that their tags bind to them rather than to a shorter prefix.
      workspaces = [...mergedConfig.workspaces, ...excludedWorkspaces];
      directories = mergedConfig.directories ?? [];
      project = mergedConfig.project;
      excludedPaths = new Set(excludedWorkspaces.map((excludedWorkspace) => excludedWorkspace.workspacePath));
    }
  } catch (error: unknown) {
    reportError(`Failed to resolve workspaces: ${describeError(error)}`);
    process.exit(1);
  }

  // Resolve tags from HEAD. The try block above sets exactly one of workspaces/singleWorkspace.
  let resolvedTags: ResolvedTag[];
  if (workspaces !== undefined) {
    resolvedTags = resolveReleaseTags({ workspaces, directories, ...(project !== undefined && { project }) });
  } else if (singleWorkspace !== undefined) {
    resolvedTags = resolveReleaseTags({ singleWorkspace });
  } else {
    throw new Error('resolveCommandTags: invariant violated; neither workspaces nor singleWorkspace was derived');
  }

  if (resolvedTags.length === 0) {
    reportError('HEAD does not have any release tags. Create tags with `release-kit tag` first.');
    process.exit(1);
  }

  // Validate --tags against resolved tag names (full tag name, not dir).
  if (tags !== undefined) {
    const availableTagNames = resolvedTags.map((t) => t.tag);
    for (const name of tags) {
      if (availableTagNames.includes(name)) {
        continue;
      }

      reportError(`Unknown tag "${name}" in --tags. Available: ${availableTagNames.join(', ')}`);
      process.exit(1);
    }
    resolvedTags = resolvedTags.filter((t) => tags.includes(t.tag));
  }

  return dropExcludedTags(resolvedTags, excludedPaths, userConfig?.releases === undefined ? 'legacy' : 'releases');
}

// region | Helpers

/**
 * Warns about and removes each tag of an excluded workspace, naming the setting that excluded it: `shouldExclude` in
 * a `workspaces` override, or a `false` entry in `releases`, which is keyed by the workspace's target name.
 */
function dropExcludedTags(
  resolvedTags: ResolvedTag[],
  excludedPaths: ReadonlySet<string>,
  surface: 'legacy' | 'releases',
): ResolvedTag[] {
  const retainedTags: ResolvedTag[] = [];
  for (const resolvedTag of resolvedTags) {
    if (resolvedTag.kind === 'package' && excludedPaths.has(resolvedTag.workspacePath)) {
      const setting = surface === 'releases' ? `releases.${resolvedTag.dir}: false` : undefined;
      console.warn(formatExcludedSkip(resolvedTag, setting));
    } else {
      retainedTags.push(resolvedTag);
    }
  }
  return retainedTags;
}

// endregion | Helpers
