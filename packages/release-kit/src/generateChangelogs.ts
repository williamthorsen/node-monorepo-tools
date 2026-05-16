import type { WorkspaceConfig } from './types.ts';

/**
 * Build a git-cliff tag pattern from one or more tag prefixes.
 *
 * Single-prefix input preserves the historical `<prefix>[0-9].*` shape. Multi-prefix input
 * returns `(prefix1|prefix2|...)[0-9].*` so git-cliff's regex-based `--tag-pattern` accepts
 * tags under any listed prefix. Each prefix is regex-escaped so metacharacters in operator-
 * supplied legacy prefixes cannot alter the pattern's meaning.
 *
 * @param tagPrefixes - Tag prefixes to match as a union (must contain at least one entry).
 */
export function buildTagPattern(tagPrefixes: readonly string[]): string {
  if (tagPrefixes.length === 0) {
    throw new Error('buildTagPattern: tagPrefixes must contain at least one entry');
  }
  if (tagPrefixes.length === 1) {
    const single = tagPrefixes[0] ?? '';
    return `${single}[0-9].*`;
  }
  const escaped = tagPrefixes.map(escapeRegex);
  return `(${escaped.join('|')})[0-9].*`;
}

/**
 * Return the workspace's derived tag prefix followed by each declared legacy-identity tag
 * prefix. Shared by `releasePrepareMono` (the production prepare path) and
 * `validateOverridesCommand` so the two compute byte-equal per-workspace tag-prefix unions.
 */
export function getAllTagPrefixes(workspace: WorkspaceConfig): string[] {
  return [workspace.tagPrefix, ...(workspace.legacyIdentities?.map((identity) => identity.tagPrefix) ?? [])];
}

/**
 * Options for `buildChangelogEntries`-driven flows that consume git-cliff output.
 *
 * The fields here mirror the subset of git-cliff CLI options that the in-package pipeline
 * still passes through (tag-pattern union, include-path filtering for monorepo workspaces).
 * `generateChangelog` and `generateChangelogs` (the prior cliff `--output` invokers) are
 * removed; markdown rendering is now handled by `renderChangelogMarkdown.ts`.
 */
export interface GenerateChangelogOptions {
  /** Tag pattern to match release tags (passed as --tag-pattern to git-cliff). */
  tagPattern?: string;
  /** Paths to include in the changelog (passed as --include-path to git-cliff). */
  includePaths?: string[];
}

/**
 * Escape regex metacharacters so a literal prefix is matched as-is.
 *
 * Derived prefixes from npm package names are restricted to `[a-z0-9-]`, but legacy entries
 * from user config may contain anything; defensive escaping prevents silent pattern drift.
 */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
