import type { ReleaseTarget } from './types.ts';

/** Returns the derived tag prefix followed by each declared legacy-identity tag prefix. */
export function getAllTagPrefixes(owner: Pick<ReleaseTarget, 'legacyIdentities' | 'tagPrefix'>): string[] {
  return [owner.tagPrefix, ...(owner.legacyIdentities?.map((identity) => identity.tagPrefix) ?? [])];
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
   * The scope of the workspace being read, its target name. When set, the read includes a change-record entry only
   * when its scopes, after `scopeAliases` resolution, name this scope, are empty, or contain `*`; when omitted, the
   * read includes every entry.
   */
  scope?: string;
}
