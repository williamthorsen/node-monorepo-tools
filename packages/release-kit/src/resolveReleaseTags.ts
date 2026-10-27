import { execFileSync } from 'node:child_process';

import { GIT_OUTPUT_LIMIT_BYTES } from '@williamthorsen/nmr-core';

import { getTargetName } from './resolveReleaseDeclaration.ts';
import { PROJECT_TARGET_ID } from './resolveReleaseTargets.ts';
import type { DirectoryConfig, ResolvedProjectConfig, WorkspaceConfig } from './types.ts';

export interface ResolvedTag {
  tag: string;
  /**
   * Whether the tag belongs to a workspace package, to a directory target, or to the composite. A directory or project
   * tag is never published to a registry but always qualifies for a GitHub Release.
   */
  kind: 'package' | 'directory' | 'project';
  /** Name of the release target that owns the tag; `PROJECT_TARGET_ID` for the composite of a `project` block. */
  dir: string;
  /** Repo-relative path of the target's package or directory; `.` for the composite. */
  workspacePath: string;
  /**
   * Whether the workspace to which this tag belongs can be published to a registry, copied from the matched
   * workspace's `WorkspaceConfig.isPublishable`. Always false for a project tag.
   */
  isPublishable: boolean;
}

/** Pattern matching a single-package tag like `v1.2.3` or `v0.10.0-beta.1`. */
const VERSION_PATTERN = /^v\d+\.\d+\.\d+/;

/** Pattern matching a bare semver suffix like `1.2.3` or `0.10.0-beta.1` (no leading `v`). */
const SEMVER_SUFFIX_PATTERN = /^\d+\.\d+\.\d+/;

/** Discriminated argument to `resolveReleaseTags`: exactly one of the two keys is meaningful. */
type ResolveReleaseTagsArgs =
  | {
      workspaces: readonly WorkspaceConfig[];
      directories?: readonly DirectoryConfig[];
      project?: Pick<ResolvedProjectConfig, 'tagPrefix' | 'name'>;
    }
  | { singleWorkspace: WorkspaceConfig };

/**
 * Resolves release tags pointing at HEAD into publishable package descriptors.
 *
 * Pass `{ workspaces }` for monorepo mode: Each tag is matched against the workspace
 * whose `tagPrefix` it starts with, and that workspace's `isPublishable` propagates onto
 * the `ResolvedTag`. Add `directories` to also match each directory target's tag, which resolves at
 * the directory with `kind: 'directory'`, and `project` to match the project tag, which resolves at the
 * repo root with `kind: 'project'`. Because `tagPrefix` is derived from `deriveWorkspaceConfig()` (the
 * same source that produced the tag), encoding and decoding stay colocated.
 *
 * Pass `{ singleWorkspace }` for single-package mode: Tags like `v1.2.3` are matched and
 * each has the workspace's `isPublishable` bit derived from `./package.json#private`.
 *
 * The no-arg form is a test-isolation convenience for unit tests that exercise tag
 * matching without needing `isPublishable` propagation; resolved tags default to
 * `isPublishable: true`. Production callers should pass one of the named forms.
 */
export function resolveReleaseTags(args?: ResolveReleaseTagsArgs): ResolvedTag[] {
  const output = execFileSync('git', ['tag', '--points-at', 'HEAD'], {
    encoding: 'utf8',
    maxBuffer: GIT_OUTPUT_LIMIT_BYTES,
  });

  const tags = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (args === undefined) {
    return resolveSinglePackageTags(tags);
  }
  if ('workspaces' in args) {
    return resolveMonorepoTags(tags, args.workspaces, args.directories ?? [], args.project);
  }
  return resolveSinglePackageTags(tags, args.singleWorkspace);
}

/**
 * Matches single-package tags of the form `v{semver}`, warning if multiple are found.
 *
 * `singleWorkspace` is undefined when invoked via the `resolveReleaseTags()` no-arg
 * test form; resolved tags default to `isPublishable: true` in that case.
 */
function resolveSinglePackageTags(tags: string[], singleWorkspace?: WorkspaceConfig): ResolvedTag[] {
  const matchedTags = tags.filter((tag) => VERSION_PATTERN.test(tag));
  const isPublishable = singleWorkspace?.isPublishable ?? true;

  if (matchedTags.length > 1) {
    console.warn(
      `Warning: Multiple version tags found on HEAD: ${matchedTags.join(', ')}. ` +
        `Publishing the same package multiple times is almost certainly unintended. Using only the first tag.`,
    );
    return matchedTags
      .slice(0, 1)
      .map((tag) => ({ tag, kind: 'package', dir: '.', workspacePath: '.', isPublishable }));
  }

  return matchedTags.map((tag) => ({ tag, kind: 'package', dir: '.', workspacePath: '.', isPublishable }));
}

/**
 * Matches monorepo tags by scanning workspaces, then directories, then the project, for a matching `tagPrefix`.
 *
 * When two workspace prefixes nest (e.g., `foo-v` and `foo-bar-v`), the longest match wins, so that `foo-bar-v1.0.0`
 * does not bind to `foo-v`. A directory or project prefix cannot nest with any other prefix, because
 * `mergeMonorepoConfig` rejects that collision.
 */
function resolveMonorepoTags(
  tags: string[],
  workspaces: readonly WorkspaceConfig[],
  directories: readonly DirectoryConfig[],
  project: Pick<ResolvedProjectConfig, 'tagPrefix' | 'name'> | undefined,
): ResolvedTag[] {
  const sortedWorkspaces = workspaces.toSorted((a, b) => b.tagPrefix.length - a.tagPrefix.length);

  const resolvedTags: ResolvedTag[] = [];

  for (const tag of tags) {
    const matchedWorkspace = findMatchingWorkspace(tag, sortedWorkspaces);
    const directory = directories.find((candidate) => hasVersionAfterPrefix(tag, candidate.tagPrefix));
    if (matchedWorkspace !== undefined) {
      resolvedTags.push({
        tag,
        kind: 'package',
        dir: getTargetName(matchedWorkspace),
        workspacePath: matchedWorkspace.workspacePath,
        isPublishable: matchedWorkspace.isPublishable,
      });
    } else if (directory !== undefined) {
      resolvedTags.push({
        tag,
        kind: 'directory',
        dir: directory.name,
        workspacePath: directory.path,
        isPublishable: false,
      });
    } else if (project !== undefined && hasVersionAfterPrefix(tag, project.tagPrefix)) {
      resolvedTags.push({
        tag,
        kind: 'project',
        dir: project.name ?? PROJECT_TARGET_ID,
        workspacePath: '.',
        isPublishable: false,
      });
    }
  }

  return resolvedTags;
}

/**
 * Returns the workspace whose `tagPrefix` begins the tag and whose version suffix matches
 * `SEMVER_SUFFIX_PATTERN`. Expects `sortedWorkspaces` to be ordered longest-prefix first.
 *
 * `tagPrefix` ends with `v` (e.g., `core-v`), so the suffix after it is a bare semver without a leading `v`.
 */
function findMatchingWorkspace(tag: string, sortedWorkspaces: readonly WorkspaceConfig[]): WorkspaceConfig | undefined {
  return sortedWorkspaces.find((workspace) => hasVersionAfterPrefix(tag, workspace.tagPrefix));
}

/** Reports whether the tag starts with `tagPrefix` and continues with a bare semver. */
function hasVersionAfterPrefix(tag: string, tagPrefix: string): boolean {
  return tag.startsWith(tagPrefix) && SEMVER_SUFFIX_PATTERN.test(tag.slice(tagPrefix.length));
}
