import { execSync } from 'node:child_process';

import { bumpAllVersions } from './bumpAllVersions.ts';
import { DEFAULT_VERSION_PATTERNS, DEFAULT_WORK_TYPES } from './defaults.ts';
import { determineBumpType } from './determineBumpType.ts';
import { generateChangelogs } from './generateChangelogs.ts';
import { getCommitsSinceTarget } from './getCommitsSinceTarget.ts';
import { hasPrettierConfig } from './hasPrettierConfig.ts';
import { parseCommitMessage } from './parseCommitMessage.ts';
import type { ParsedCommit, ReleaseConfig, ReleaseType } from './types.ts';

/** Options for the release preparation workflow. */
export interface ReleasePrepareOptions {
  /** If true, logs actions without modifying files. */
  dryRun: boolean;
  /** Bypass the "no commits since last tag" check (monorepo only). Requires `bumpOverride`. */
  force?: boolean;
  /** Override the bump type instead of determining it from commits. */
  bumpOverride?: ReleaseType;
}

/**
 * Orchestrates the release preparation workflow.
 *
 * 1. Gets commits since the last tag.
 * 2. Determines the bump type from commits (or uses the override).
 * 3. Bumps all configured package.json version fields.
 * 4. Generates changelogs via git-cliff.
 * 5. Runs the optional format command.
 *
 * @param config - The release configuration.
 * @param options - Options controlling dry-run mode and optional bump override.
 */
export function releasePrepare(config: ReleaseConfig, options: ReleasePrepareOptions): string[] {
  const { dryRun, bumpOverride } = options;
  const workTypes = config.workTypes ?? { ...DEFAULT_WORK_TYPES };
  const versionPatterns = config.versionPatterns ?? { ...DEFAULT_VERSION_PATTERNS };

  // 1. Get commits since last tag
  console.info('Finding commits since last release...');
  const { tag, commits } = getCommitsSinceTarget(config.tagPrefix);
  console.info(`  Found ${commits.length} commits since ${tag ?? 'the beginning'}`);

  // 2. Determine bump type
  let releaseType: ReleaseType | undefined;

  if (bumpOverride === undefined) {
    const parsedCommits = commits
      .map((c) => parseCommitMessage(c.message, c.hash, workTypes, config.workspaceAliases))
      .filter((c): c is ParsedCommit => c !== undefined);

    console.info(`  Parsed ${parsedCommits.length} typed commits`);
    releaseType = determineBumpType(parsedCommits, workTypes, versionPatterns);
  } else {
    releaseType = bumpOverride;
    console.info(`  Using bump override: ${releaseType}`);
  }

  if (releaseType === undefined) {
    console.info('No release-worthy changes found. Skipping.');
    return [];
  }

  // 3. Bump all versions
  console.info(`Bumping versions (${releaseType})...`);
  const newVersion = bumpAllVersions(config.packageFiles, releaseType, dryRun);
  const newTag = `${config.tagPrefix}${newVersion}`;

  // 4. Generate changelogs
  console.info('Generating changelogs...');
  generateChangelogs(config, newTag, dryRun);

  // 5. Run format command, appending modified file paths
  const formatCommand = config.formatCommand ?? (hasPrettierConfig() ? 'npx prettier --write' : undefined);
  if (formatCommand !== undefined) {
    const modifiedFiles = [...config.packageFiles, ...config.changelogPaths.map((p) => `${p}/CHANGELOG.md`)];
    const fullCommand = `${formatCommand} ${modifiedFiles.join(' ')}`;
    if (dryRun) {
      console.info(`  [dry-run] Would run format command: ${fullCommand}`);
    } else {
      console.info(`  Running format command: ${fullCommand}`);
      try {
        execSync(fullCommand, { stdio: 'inherit' });
      } catch (error: unknown) {
        throw new Error(
          `Format command failed ('${fullCommand}'): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  console.info(`Release preparation complete: ${newTag}`);
  return [newTag];
}
