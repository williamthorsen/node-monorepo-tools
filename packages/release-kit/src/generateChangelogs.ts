import { execFileSync } from 'node:child_process';

import { resolveCliffConfigPath } from './resolveCliffConfigPath.ts';
import type { ReleaseConfig } from './types.ts';

/** Build a git-cliff tag pattern from a tag prefix (e.g., `"release-kit-v"` → `"release-kit-v[0-9].*"`). */
export function buildTagPattern(tagPrefix: string): string {
  return `${tagPrefix}[0-9].*`;
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
 * Invokes `git-cliff` via `npx --yes` using `execFileSync` with an argument array,
 * avoiding shell interpretation of paths. Returns the output file path as a
 * single-element array for consistency with `generateChangelogs`.
 */
export function generateChangelog(
  config: Pick<ReleaseConfig, 'cliffConfigPath'>,
  changelogPath: string,
  tag: string,
  dryRun: boolean,
  options?: GenerateChangelogOptions,
): string[] {
  const cliffConfigPath = resolveCliffConfigPath(config.cliffConfigPath, import.meta.url);
  const outputFile = `${changelogPath}/CHANGELOG.md`;
  const args = ['--config', cliffConfigPath, '--output', outputFile, '--tag', tag];

  // Append --tag-pattern flag when a tag pattern is provided.
  if (options?.tagPattern) {
    args.push('--tag-pattern', options.tagPattern);
  }

  // Append --include-path flags when path filtering is requested.
  for (const includePath of options?.includePaths ?? []) {
    args.push('--include-path', includePath);
  }

  if (!dryRun) {
    try {
      execFileSync('npx', ['--yes', 'git-cliff', ...args], { stdio: 'inherit' });
    } catch (error: unknown) {
      throw new Error(
        `Failed to generate changelog for ${outputFile}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return [outputFile];
}

/**
 * Generate changelogs for each configured changelog path by delegating to `generateChangelog`.
 *
 * Returns the collected output file paths from all `generateChangelog` calls.
 */
export function generateChangelogs(config: ReleaseConfig, tag: string, dryRun: boolean): string[] {
  const tagPattern = buildTagPattern(config.tagPrefix);
  const results: string[] = [];
  for (const changelogPath of config.changelogPaths) {
    results.push(...generateChangelog(config, changelogPath, tag, dryRun, { tagPattern }));
  }
  return results;
}
