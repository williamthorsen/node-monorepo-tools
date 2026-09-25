/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import { basename } from 'node:path';

import { reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { deriveWorkspaceConfig } from './deriveWorkspaceConfig.ts';
import { describeEmptyWorkspace, discoverWorkspaces, type WorkspaceDiscovery } from './discoverWorkspaces.ts';
import { formatExcludedSkip } from './formatExcludedSkip.ts';
import { mergeMonorepoConfig, readRootPackageVersion } from './loadConfig.ts';
import { type ResolvedTag, resolveReleaseTags } from './resolveReleaseTags.ts';
import type { ReleaseKitConfig, WorkspaceConfig } from './types.ts';

/**
 * Discover workspaces, resolve release tags from HEAD, validate `--tags` names against the
 * full resolved tag names (e.g., `nmr-core-v1.3.0`), and return the filtered tag list.
 * Works in both single-package and monorepo modes. Exits with an error message on any validation
 * failure — including `deriveWorkspaceConfig()` throws for workspaces missing a `package.json` `name` field,
 * a config that `mergeMonorepoConfig` rejects, and a workspace declaring patterns that resolve to no package,
 * which is not single-package mode.
 *
 * In monorepo mode the workspace list is `userConfig` merged over the discovered workspaces, as `prepare` builds it.
 * A tag on HEAD whose workspace the config excludes is dropped with a warning, whether or not `--tags` names it,
 * and still counts as a tag on HEAD, so a HEAD whose tags are all excluded returns an empty list rather than
 * failing. Single-package mode ignores `userConfig`.
 *
 * In both modes `deriveWorkspaceConfig` is called so `WorkspaceConfig.isPublishable` (read
 * from `package.json#private`) propagates onto each `ResolvedTag`.
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

  // Build workspace list so resolveReleaseTags can match tags by tagPrefix (derived from pkg.name)
  // and propagate isPublishable. In single-package mode, derive the single workspace config from
  // `./package.json` so its `isPublishable` reaches each ResolvedTag.
  let workspaces: WorkspaceConfig[] | undefined;
  let singleWorkspace: WorkspaceConfig | undefined;
  const excludedDirs = workspace.kind === 'packages' ? collectExcludedDirs(userConfig) : new Set<string>();
  try {
    if (workspace.kind === 'single-package') {
      singleWorkspace = deriveWorkspaceConfig('.');
    } else {
      workspaces = buildMonorepoWorkspaces(workspace.packageDirs, userConfig, excludedDirs);
    }
  } catch (error: unknown) {
    reportError(`Failed to resolve workspaces: ${describeError(error)}`);
    process.exit(1);
  }

  // Resolve tags from HEAD. The try block above sets exactly one of workspaces/singleWorkspace.
  let resolvedTags: ResolvedTag[];
  if (workspaces !== undefined) {
    resolvedTags = resolveReleaseTags({ workspaces });
  } else if (singleWorkspace !== undefined) {
    resolvedTags = resolveReleaseTags({ singleWorkspace });
  } else {
    throw new Error('resolveCommandTags: invariant violated — neither workspaces nor singleWorkspace was derived');
  }

  if (resolvedTags.length === 0) {
    reportError('No release tags found on HEAD. Create tags with `release-kit tag` first.');
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

  return dropExcludedTags(resolvedTags, excludedDirs);
}

// region | Helpers

/**
 * Returns the config-merged workspaces followed by the ones the config excludes, so that tag matching sees every
 * discovered prefix and an excluded workspace's tag binds to that workspace rather than to a shorter prefix.
 */
function buildMonorepoWorkspaces(
  packageDirs: string[],
  userConfig: ReleaseKitConfig | undefined,
  excludedDirs: ReadonlySet<string>,
): WorkspaceConfig[] {
  const { workspaces } = mergeMonorepoConfig(packageDirs, userConfig, readRootPackageVersion());
  if (excludedDirs.size === 0) {
    return workspaces;
  }

  const excluded = packageDirs
    .filter((packageDir) => excludedDirs.has(basename(packageDir)))
    .map((packageDir) => deriveWorkspaceConfig(packageDir));
  return [...workspaces, ...excluded];
}

/** Returns the `dir` of every workspace override that sets `shouldExclude: true`. */
function collectExcludedDirs(userConfig: ReleaseKitConfig | undefined): Set<string> {
  const overrides = userConfig?.workspaces ?? [];
  return new Set(overrides.filter((override) => override.shouldExclude === true).map((override) => override.dir));
}

/** Warns about and removes each tag whose workspace the config excludes. */
function dropExcludedTags(resolvedTags: ResolvedTag[], excludedDirs: ReadonlySet<string>): ResolvedTag[] {
  const retained: ResolvedTag[] = [];
  for (const resolvedTag of resolvedTags) {
    if (excludedDirs.has(resolvedTag.dir)) {
      console.warn(formatExcludedSkip(resolvedTag));
    } else {
      retained.push(resolvedTag);
    }
  }
  return retained;
}

// endregion | Helpers
