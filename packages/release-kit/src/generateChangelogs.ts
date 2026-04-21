import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveCliffConfigPath } from './resolveCliffConfigPath.ts';
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
  const resolvedConfigPath = resolveCliffConfigPath(config.cliffConfigPath, import.meta.url);

  // git-cliff rejects non-.toml extensions. Copy bundled .template files to a temp .toml file.
  let cliffConfigPath = resolvedConfigPath;
  let tempDir: string | undefined;
  if (resolvedConfigPath.endsWith('.template')) {
    tempDir = mkdtempSync(join(tmpdir(), 'cliff-'));
    cliffConfigPath = join(tempDir, 'cliff.toml');
    copyFileSync(resolvedConfigPath, cliffConfigPath);
  }

  const outputFile = `${changelogPath}/CHANGELOG.md`;
  const args = ['--config', cliffConfigPath, '--output', outputFile, '--tag', tag];

  // Append --tag-pattern flag when a tag pattern is provided.
  if (options?.tagPattern !== undefined) {
    args.push('--tag-pattern', options.tagPattern);
  }

  // Append --include-path flags when path filtering is requested.
  for (const includePath of options?.includePaths ?? []) {
    args.push('--include-path', includePath);
  }

  try {
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
  } finally {
    if (tempDir !== undefined) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
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
