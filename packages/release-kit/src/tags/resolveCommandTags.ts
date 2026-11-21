import { join } from 'node:path';

import { isRecord, UserError } from '@williamthorsen/nmr-core';
import { UsageError } from '@williamthorsen/nmr-core/cli';

import type { ReleaseKitConfig } from '../config/config-schema.ts';
import { deriveWorkspaceConfig } from '../config/deriveWorkspaceConfig.ts';
import { readRootPackageVersion } from '../config/loadConfig.ts';
import { mergeMonorepoConfig } from '../config/merge-config.ts';
import { getTargetName } from '../config/resolveReleaseDeclaration.ts';
import { readJsonFile } from '../portable/readJsonFile.ts';
import { prefixUserError } from '../portable/user-error-chaining.ts';
import { describeEmptyWorkspace, discoverWorkspaces, type WorkspaceDiscovery } from '../targets/discoverWorkspaces.ts';
import type { DirectoryConfig, ResolvedProjectConfig, WorkspaceConfig } from '../types.ts';
import { formatExcludedSkip } from './formatExcludedSkip.ts';
import { type ResolvedTag, resolveReleaseTags } from './resolveReleaseTags.ts';
/**
 * Discovers workspaces, resolves release tags from HEAD, validates `--tags` names against the full resolved tag
 * names (e.g., `nmr-core-v1.3.0`), and returns the filtered tag list. Throws a `UserError` when workspace discovery
 * fails, when a workspace's `package.json` does not have a `name` field, when `mergeMonorepoConfig` rejects the
 * config, when the workspace does not resolve to any package (which is not single-package mode), and when HEAD does
 * not have any release tags and `shouldPreviewUntaggedHead` is not set; throws a `UsageError` for a `--tags` name
 * that HEAD lacks.
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
 *
 * With `shouldPreviewUntaggedHead`, a HEAD without release tags does not fail: Each publishable workspace that the
 * config keeps gets the tag that a release of its manifest version would create, so that a dry run can preview it.
 */
export function resolveCommandTags(
  tags: string[] | undefined,
  userConfig: ReleaseKitConfig | undefined,
  options: ResolveCommandTagsOptions = {},
): ResolvedTag[] {
  // Discover workspaces to determine single-package vs monorepo mode.
  let workspace: WorkspaceDiscovery;
  try {
    workspace = discoverWorkspaces();
  } catch (error: unknown) {
    throw prefixUserError('Failed to discover workspaces', error);
  }

  if (workspace.kind === 'empty') {
    throw new UserError(`No workspace package to tag. ${describeEmptyWorkspace(workspace)}`);
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
    throw prefixUserError('Failed to resolve workspaces', error);
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
    if (options.shouldPreviewUntaggedHead !== true) {
      throw new UserError('HEAD does not have any release tags. Create tags with `release-kit tag` first.');
    }

    console.info('HEAD does not have any release tags; previewing every publishable package at its manifest version.');
    resolvedTags =
      workspaces === undefined
        ? synthesizeTags(singleWorkspace === undefined ? [] : [singleWorkspace], '.')
        : synthesizeTags(
            workspaces.filter((workspaceConfig) => !excludedPaths.has(workspaceConfig.workspacePath)),
            undefined,
          );
  }

  // Validate --tags against resolved tag names (full tag name, not dir).
  if (tags !== undefined) {
    const availableTagNames = resolvedTags.map((t) => t.tag);
    for (const name of tags) {
      if (availableTagNames.includes(name)) {
        continue;
      }

      throw new UsageError(`Unknown tag "${name}" in --tags. Available: ${availableTagNames.join(', ')}`);
    }
    resolvedTags = resolvedTags.filter((t) => tags.includes(t.tag));
  }

  return dropExcludedTags(resolvedTags, excludedPaths, userConfig?.releases === undefined ? 'legacy' : 'releases');
}

export interface ResolveCommandTagsOptions {
  /** Returns a tag for each publishable workspace, rather than failing, when HEAD does not have any release tags. */
  shouldPreviewUntaggedHead?: boolean;
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

/** Reads the `version` of a workspace's `package.json`, throwing when the manifest does not set one. */
function readManifestVersion(workspacePath: string): string {
  const manifestPath = join(workspacePath, 'package.json');
  const manifest = readJsonFile(manifestPath);
  const version = isRecord(manifest) ? manifest['version'] : undefined;
  if (typeof version !== 'string' || version === '') {
    throw new UserError(`Cannot preview ${workspacePath}: ${manifestPath} does not set a version.`);
  }
  return version;
}

/**
 * Builds the tag that a release of each publishable workspace's manifest version would create, naming each by its
 * release target, or by `dir` when it is given.
 */
function synthesizeTags(workspaceConfigs: readonly WorkspaceConfig[], dir: string | undefined): ResolvedTag[] {
  return workspaceConfigs
    .filter((workspaceConfig) => workspaceConfig.isPublishable)
    .map((workspaceConfig): ResolvedTag => ({
      tag: `${workspaceConfig.tagPrefix}${readManifestVersion(workspaceConfig.workspacePath)}`,
      kind: 'package',
      dir: dir ?? getTargetName(workspaceConfig),
      workspacePath: workspaceConfig.workspacePath,
      isPublishable: true,
    }));
}

// endregion | Helpers
