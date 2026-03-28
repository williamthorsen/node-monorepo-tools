import { execSync } from 'node:child_process';

import { bumpAllVersions } from './bumpAllVersions.ts';
import { DEFAULT_VERSION_PATTERNS, DEFAULT_WORK_TYPES } from './defaults.ts';
import { determineBumpType } from './determineBumpType.ts';
import { generateChangelogs } from './generateChangelogs.ts';
import { getCommitsSinceTarget } from './getCommitsSinceTarget.ts';
import { hasPrettierConfig } from './hasPrettierConfig.ts';
import { parseCommitMessage } from './parseCommitMessage.ts';
import type { Commit, ParsedCommit, PrepareResult, ReleaseConfig, ReleaseType } from './types.ts';

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
 * Orchestrate the release preparation workflow for a single package.
 *
 * 1. Gets commits since the last tag.
 * 2. Determines the bump type from commits (or uses the override).
 * 3. Bumps all configured package.json version fields.
 * 4. Generates changelogs via git-cliff.
 * 5. Runs the optional format command.
 *
 * Returns a structured `PrepareResult` with all data needed for presentation.
 */
export function releasePrepare(config: ReleaseConfig, options: ReleasePrepareOptions): PrepareResult {
  const { dryRun, bumpOverride } = options;
  const workTypes = config.workTypes ?? { ...DEFAULT_WORK_TYPES };
  const versionPatterns = config.versionPatterns ?? { ...DEFAULT_VERSION_PATTERNS };

  // 1. Get commits since last tag
  const { tag, commits } = getCommitsSinceTarget(config.tagPrefix);

  // 2. Determine bump type
  let releaseType: ReleaseType | undefined;
  let parsedCommitCount: number | undefined;
  let unparseableCommits: Commit[] | undefined;

  if (bumpOverride === undefined) {
    const parsedCommits: ParsedCommit[] = [];
    const unparseable: Commit[] = [];

    for (const commit of commits) {
      const parsed = parseCommitMessage(commit.message, commit.hash, workTypes, config.workspaceAliases);
      if (parsed === undefined) {
        unparseable.push(commit);
      } else {
        parsedCommits.push(parsed);
      }
    }

    parsedCommitCount = parsedCommits.length;
    if (unparseable.length > 0) {
      unparseableCommits = unparseable;
    }

    releaseType = determineBumpType(parsedCommits, workTypes, versionPatterns);

    // Apply patch floor: commits exist but none determined a bump type
    if (releaseType === undefined && commits.length > 0) {
      releaseType = 'patch';
    }
  } else {
    releaseType = bumpOverride;
  }

  if (releaseType === undefined) {
    return {
      components: [
        {
          status: 'skipped',
          previousTag: tag,
          commitCount: commits.length,
          parsedCommitCount,
          unparseableCommits,
          bumpedFiles: [],
          changelogFiles: [],
          skipReason: 'No release-worthy changes found. Skipping.',
        },
      ],
      tags: [],
      dryRun,
    };
  }

  // 3. Bump all versions
  const bump = bumpAllVersions(config.packageFiles, releaseType, dryRun);
  const newTag = `${config.tagPrefix}${bump.newVersion}`;

  // 4. Generate changelogs
  const changelogFiles = generateChangelogs(config, newTag, dryRun);

  // 5. Run format command, appending modified file paths
  const formatCommandStr = config.formatCommand ?? (hasPrettierConfig() ? 'npx prettier --write' : undefined);
  let formatCommand: PrepareResult['formatCommand'];

  if (formatCommandStr !== undefined) {
    const modifiedFiles = [...config.packageFiles, ...config.changelogPaths.map((p) => `${p}/CHANGELOG.md`)];
    const fullCommand = `${formatCommandStr} ${modifiedFiles.join(' ')}`;

    if (dryRun) {
      formatCommand = { command: fullCommand, executed: false, files: modifiedFiles };
    } else {
      try {
        execSync(fullCommand, { stdio: 'inherit' });
      } catch (error: unknown) {
        throw new Error(
          `Format command failed ('${fullCommand}'): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      formatCommand = { command: fullCommand, executed: true, files: modifiedFiles };
    }
  }

  return {
    components: [
      {
        status: 'released',
        previousTag: tag,
        commitCount: commits.length,
        parsedCommitCount,
        releaseType,
        currentVersion: bump.currentVersion,
        newVersion: bump.newVersion,
        tag: newTag,
        bumpedFiles: bump.files,
        changelogFiles,
        unparseableCommits,
      },
    ],
    tags: [newTag],
    formatCommand,
    dryRun,
  };
}
