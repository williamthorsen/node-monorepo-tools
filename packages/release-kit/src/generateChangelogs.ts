import { execFileSync } from 'node:child_process';

import { resolveCliffConfigPath } from './resolveCliffConfigPath.ts';
import type { ReleaseConfig } from './types.ts';

/** Options for single-changelog generation. */
export interface GenerateChangelogOptions {
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
  const results: string[] = [];
  for (const changelogPath of config.changelogPaths) {
    results.push(...generateChangelog(config, changelogPath, tag, dryRun));
  }
  return results;
}
