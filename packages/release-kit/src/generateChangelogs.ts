import type { WorkspaceConfig } from './types.ts';

/** Returns the workspace's derived tag prefix followed by each declared legacy-identity tag prefix. */
export function getAllTagPrefixes(workspace: WorkspaceConfig): string[] {
  return [workspace.tagPrefix, ...(workspace.legacyIdentities?.map((identity) => identity.tagPrefix) ?? [])];
}

/**
 * Options for `readReleaseHistory`: the tag prefixes and pathspecs that bound its release windows, and the workspace
 * to which it routes change-record entries.
 */
export interface GenerateChangelogOptions {
  /** Tag prefixes to match as a union; must contain at least one entry. */
  tagPrefixes: readonly string[];
  /** Git pathspecs restricting the history to commits that touch them; all paths when omitted. */
  paths?: readonly string[];
  /**
   * The `dir` of the workspace being read. When set, a change-record entry reaches the read only when its scopes, after
   * `scopeAliases` resolution, name this `dir`, are empty, or contain `*`; when omitted, every entry reaches it.
   */
  workspaceDir?: string;
}
