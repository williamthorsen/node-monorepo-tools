import { execFileSync } from 'node:child_process';

import { dim } from './format.ts';
import { resolveCliffConfigPath } from './resolveCliffConfigPath.ts';
import type { ReleaseConfig } from './types.ts';

/** Options for single-changelog generation. */
export interface GenerateChangelogOptions {
  /** Paths to include in the changelog (passed as --include-path to git-cliff). */
  includePaths?: string[];
}

/**
 * Generates a single changelog using git-cliff.
 *
 * Invokes `git-cliff` via `npx --yes` using `execFileSync` with an argument array,
 * avoiding shell interpretation of paths. The `--yes` flag auto-accepts the
 * download prompt so the command does not hang in non-interactive CI environments.
 * The `npx` command downloads `git-cliff` on first invocation and caches it for
 * subsequent calls.
 *
 * @param config - Object containing the optional `cliffConfigPath`.
 * @param changelogPath - Directory in which to write the CHANGELOG.md file.
 * @param tag - The git tag to generate the changelog up to (e.g., 'v1.2.3').
 * @param dryRun - If true, logs the command without executing it.
 * @param options - Optional settings including paths to filter by.
 */
export function generateChangelog(
  config: Pick<ReleaseConfig, 'cliffConfigPath'>,
  changelogPath: string,
  tag: string,
  dryRun: boolean,
  options?: GenerateChangelogOptions,
): void {
  const cliffConfigPath = resolveCliffConfigPath(config.cliffConfigPath, import.meta.url);
  const outputFile = `${changelogPath}/CHANGELOG.md`;
  const args = ['--config', cliffConfigPath, '--output', outputFile, '--tag', tag];

  // Append --include-path flags when path filtering is requested.
  for (const includePath of options?.includePaths ?? []) {
    args.push('--include-path', includePath);
  }

  if (dryRun) {
    console.info(dim(`  [dry-run] Would run: npx --yes git-cliff ${args.join(' ')}`));
    return;
  }

  console.info(dim(`  Generating changelog: ${outputFile}`));
  try {
    execFileSync('npx', ['--yes', 'git-cliff', ...args], { stdio: 'inherit' });
  } catch (error: unknown) {
    throw new Error(
      `Failed to generate changelog for ${outputFile}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Generates changelogs for each configured changelog path by delegating to `generateChangelog`.
 *
 * @param config - The release configuration containing changelog paths and optional cliff config path.
 * @param tag - The git tag to generate the changelog up to (e.g., 'v1.2.3').
 * @param dryRun - If true, logs the commands without executing them.
 */
export function generateChangelogs(config: ReleaseConfig, tag: string, dryRun: boolean): void {
  for (const changelogPath of config.changelogPaths) {
    generateChangelog(config, changelogPath, tag, dryRun);
  }
}
