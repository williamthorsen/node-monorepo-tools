import type { WorkspaceConfig } from './types.ts';

/**
 * Return the workspace's derived tag prefix followed by each declared legacy-identity tag
 * prefix. Shared by `releasePrepareMono` (the production prepare path) and
 * `validateOverridesCommand` so the two compute byte-equal per-workspace tag-prefix unions.
 */
export function getAllTagPrefixes(workspace: WorkspaceConfig): string[] {
  return [workspace.tagPrefix, ...(workspace.legacyIdentities?.map((identity) => identity.tagPrefix) ?? [])];
}

/** Options for `buildChangelogEntries`: the tag prefixes and pathspecs that bound its release windows. */
export interface GenerateChangelogOptions {
  /** Tag prefixes to match as a union; must contain at least one entry. */
  tagPrefixes: readonly string[];
  /** Git pathspecs restricting the history to commits that touch them; all paths when omitted. */
  paths?: readonly string[];
}
