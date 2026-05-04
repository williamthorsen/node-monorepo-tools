import { resolveCliffConfigPath } from './resolveCliffConfigPath.ts';
import { runGitCliff } from './runGitCliff.ts';
import type { ReleaseConfig } from './types.ts';

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
 * Escape regex metacharacters so a literal prefix is matched as-is.
 *
 * Derived prefixes from npm package names are restricted to `[a-z0-9-]`, but legacy entries
 * from user config may contain anything; defensive escaping prevents silent pattern drift.
 */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** Options for single-changelog generation. */
export interface GenerateChangelogOptions {
  /** Tag pattern to match release tags (passed as --tag-pattern to git-cliff). */
  tagPattern?: string;
  /** Paths to include in the changelog (passed as --include-path to git-cliff). */
  includePaths?: string[];
}

/**
 * Generate a single changelog using git-cliff.
 *
 * Invokes `git-cliff` via the shared `runGitCliff` helper (which spawns `npx`). Returns
 * the output file path as a single-element array for consistency with `generateChangelogs`.
 * In dry-run mode the helper is not invoked at all — no subprocess, no temp dir.
 */
export function generateChangelog(
  config: Pick<ReleaseConfig, 'cliffConfigPath'>,
  changelogPath: string,
  tag: string,
  dryRun: boolean,
  options?: GenerateChangelogOptions,
): string[] {
  const outputFile = `${changelogPath}/CHANGELOG.md`;

  if (dryRun) {
    return [outputFile];
  }

  const resolvedConfigPath = resolveCliffConfigPath(config.cliffConfigPath, import.meta.url);
  const cliffArgs = ['--output', outputFile, '--tag', tag];

  // Append --tag-pattern flag when a tag pattern is provided.
  if (options?.tagPattern !== undefined) {
    cliffArgs.push('--tag-pattern', options.tagPattern);
  }

  // Append --include-path flags when path filtering is requested.
  for (const includePath of options?.includePaths ?? []) {
    cliffArgs.push('--include-path', includePath);
  }

  try {
    runGitCliff(resolvedConfigPath, cliffArgs, 'inherit');
  } catch (error: unknown) {
    throw new Error(
      `Failed to generate changelog for ${outputFile}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return [outputFile];
}

/**
 * Generate changelogs for each configured changelog path by delegating to `generateChangelog`.
 *
 * Returns the collected output file paths from all `generateChangelog` calls.
 */
export function generateChangelogs(config: ReleaseConfig, tag: string, dryRun: boolean): string[] {
  const tagPattern = buildTagPattern([config.tagPrefix]);
  const results: string[] = [];
  for (const changelogPath of config.changelogPaths) {
    results.push(...generateChangelog(config, changelogPath, tag, dryRun, { tagPattern }));
  }
  return results;
}
