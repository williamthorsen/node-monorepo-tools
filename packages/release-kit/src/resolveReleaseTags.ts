import { execFileSync } from 'node:child_process';

import type { WorkspaceConfig } from './types.ts';

export interface ResolvedTag {
  tag: string;
  dir: string;
  workspacePath: string;
  /**
   * Whether the workspace this tag belongs to can be published to a registry. Propagated
   * from the matched `WorkspaceConfig.isPublishable` (monorepo) or from the single-package
   * workspace config (single-package mode). Consumed by `release-kit publish` to filter the
   * tag set; other commands ignore it.
   */
  isPublishable: boolean;
}

/** Pattern matching a single-package tag like `v1.2.3` or `v0.10.0-beta.1`. */
const VERSION_PATTERN = /^v\d+\.\d+\.\d+/;

/** Pattern matching a bare semver suffix like `1.2.3` or `0.10.0-beta.1` (no leading `v`). */
const SEMVER_SUFFIX_PATTERN = /^\d+\.\d+\.\d+/;

/** Discriminated argument to `resolveReleaseTags`: exactly one of the two keys is meaningful. */
type ResolveReleaseTagsArgs = { workspaces: readonly WorkspaceConfig[] } | { singleWorkspace: WorkspaceConfig };

/**
 * Resolve release tags pointing at HEAD into publishable package descriptors.
 *
 * Pass `{ workspaces }` for monorepo mode: each tag is matched against the workspace
 * whose `tagPrefix` it starts with, and that workspace's `isPublishable` propagates onto
 * the `ResolvedTag`. Because `tagPrefix` is derived from `deriveWorkspaceConfig()` (the
 * same source that produced the tag), encoding and decoding stay colocated.
 *
 * Pass `{ singleWorkspace }` for single-package mode: tags like `v1.2.3` are matched and
 * each carries the workspace's `isPublishable` bit derived from `./package.json#private`.
 *
 * The no-arg form is a test-isolation convenience for unit tests that exercise tag
 * matching without needing `isPublishable` propagation; resolved tags default to
 * `isPublishable: true`. Production callers should pass one of the named forms.
 */
export function resolveReleaseTags(args?: ResolveReleaseTagsArgs): ResolvedTag[] {
  const output = execFileSync('git', ['tag', '--points-at', 'HEAD'], { encoding: 'utf8' });

  const tags = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (args === undefined) {
    return resolveSinglePackageTags(tags);
  }
  if ('workspaces' in args) {
    return resolveMonorepoTags(tags, args.workspaces);
  }
  return resolveSinglePackageTags(tags, args.singleWorkspace);
}

/**
 * Match single-package tags of the form `v{semver}`, warning if multiple are found.
 *
 * `singleWorkspace` is undefined when invoked via the `resolveReleaseTags()` no-arg
 * test form; resolved tags default to `isPublishable: true` in that case.
 */
function resolveSinglePackageTags(tags: string[], singleWorkspace?: WorkspaceConfig): ResolvedTag[] {
  const matched = tags.filter((tag) => VERSION_PATTERN.test(tag));
  const isPublishable = singleWorkspace?.isPublishable ?? true;

  if (matched.length > 1) {
    console.warn(
      `Warning: Multiple version tags found on HEAD: ${matched.join(', ')}. ` +
        `Publishing the same package multiple times is almost certainly unintended. Using only the first tag.`,
    );
    return matched.slice(0, 1).map((tag) => ({ tag, dir: '.', workspacePath: '.', isPublishable }));
  }

  return matched.map((tag) => ({ tag, dir: '.', workspacePath: '.', isPublishable }));
}

/**
 * Match monorepo tags by scanning workspaces for a matching `tagPrefix`.
 *
 * When two prefixes nest (e.g., `foo-v` and `foo-bar-v`), prefer the longest match so
 * `foo-bar-v1.0.0` does not bind to `foo-v`.
 */
function resolveMonorepoTags(tags: string[], workspaces: readonly WorkspaceConfig[]): ResolvedTag[] {
  // Sort workspaces by tagPrefix length descending so the longest match wins on nested prefixes.
  // eslint-disable-next-line unicorn/no-array-sort -- toSorted requires Node 20+; engine target is >=18.17.0
  const sortedWorkspaces = [...workspaces].sort((a, b) => b.tagPrefix.length - a.tagPrefix.length);

  const resolved: ResolvedTag[] = [];

  for (const tag of tags) {
    const match = findMatchingWorkspace(tag, sortedWorkspaces);
    if (match !== undefined) {
      resolved.push({ tag, dir: match.dir, workspacePath: match.workspacePath, isPublishable: match.isPublishable });
    }
  }

  return resolved;
}

/**
 * Return the workspace whose `tagPrefix` the tag starts with and whose version suffix matches
 * `SEMVER_SUFFIX_PATTERN`. Expects `sortedWorkspaces` to be ordered longest-prefix first.
 *
 * `tagPrefix` ends with `v` (e.g., `core-v`), so `tag.slice(w.tagPrefix.length)` yields a bare
 * semver without a leading `v` — matched directly by `SEMVER_SUFFIX_PATTERN`.
 */
function findMatchingWorkspace(tag: string, sortedWorkspaces: readonly WorkspaceConfig[]): WorkspaceConfig | undefined {
  for (const workspace of sortedWorkspaces) {
    if (!tag.startsWith(workspace.tagPrefix)) {
      continue;
    }
    const versionSuffix = tag.slice(workspace.tagPrefix.length);
    if (SEMVER_SUFFIX_PATTERN.test(versionSuffix)) {
      return workspace;
    }
  }
  return undefined;
}
