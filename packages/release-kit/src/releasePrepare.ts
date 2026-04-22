import { execSync } from 'node:child_process';

import { bumpAllVersions, setAllVersions } from './bumpAllVersions.ts';
import { isForwardVersion } from './compareVersions.ts';
import { DEFAULT_VERSION_PATTERNS, DEFAULT_WORK_TYPES } from './defaults.ts';
import { determineBumpFromCommits } from './determineBumpFromCommits.ts';
import { generateChangelogJson } from './generateChangelogJson.ts';
import { generateChangelogs } from './generateChangelogs.ts';
import { getCommitsSinceTarget } from './getCommitsSinceTarget.ts';
import { hasPrettierConfig } from './hasPrettierConfig.ts';
import { readCurrentVersion } from './readCurrentVersion.ts';
import type { BumpResult, Commit, PrepareResult, ReleaseConfig, ReleaseType } from './types.ts';

/** Options for the release preparation workflow. */
export interface ReleasePrepareOptions {
  /** If true, logs actions without modifying files. */
  dryRun: boolean;
  /** Bypass the "no commits since last tag" check (monorepo only). Requires `bumpOverride`. */
  force?: boolean;
  /** Override the bump type instead of determining it from commits. */
  bumpOverride?: ReleaseType;
  /**
   * Explicit target version (canonical `N.N.N`) that bypasses commit-derived bump logic.
   * Mutually exclusive with `bumpOverride`. In monorepo mode the caller must narrow
   * `config.workspaces` to a single workspace before invoking.
   */
  setVersion?: string;
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
  const { dryRun, bumpOverride, setVersion } = options;
  const workTypes = config.workTypes ?? { ...DEFAULT_WORK_TYPES };
  const versionPatterns = config.versionPatterns ?? { ...DEFAULT_VERSION_PATTERNS };

  // 1. Get commits since last tag
  const { tag, commits } = getCommitsSinceTarget([config.tagPrefix]);

  // 2. Determine bump type (or use the explicit setVersion bypass)
  let releaseType: ReleaseType | undefined;
  let parsedCommitCount: number | undefined;
  let unparseableCommits: Commit[] | undefined;
  let bump: BumpResult;

  if (setVersion !== undefined) {
    // Bypass commit-derived bump logic. Read the current version directly from the primary
    // package file so validation runs once, then perform a single write honouring `dryRun`.
    const primaryPackageFile = config.packageFiles[0];
    if (primaryPackageFile === undefined) {
      throw new Error('No package files specified');
    }
    const currentVersion = readCurrentVersion(primaryPackageFile);
    if (currentVersion === undefined) {
      throw new Error(`Cannot validate --set-version: failed to read current version from ${primaryPackageFile}`);
    }
    if (!isForwardVersion(currentVersion, setVersion)) {
      throw new Error(`--set-version ${setVersion} is not greater than current version ${currentVersion}`);
    }
    bump = setAllVersions(config.packageFiles, setVersion, dryRun);
  } else {
    if (bumpOverride === undefined) {
      const determination = determineBumpFromCommits(commits, workTypes, versionPatterns, config.scopeAliases);
      parsedCommitCount = determination.parsedCommitCount;
      unparseableCommits = determination.unparseableCommits;
      releaseType = determination.releaseType;
    } else {
      releaseType = bumpOverride;
    }

    if (releaseType === undefined) {
      return {
        workspaces: [
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
    bump = bumpAllVersions(config.packageFiles, releaseType, dryRun);
  }

  const newTag = `${config.tagPrefix}${bump.newVersion}`;

  // 4. Generate changelogs
  const changelogFiles = generateChangelogs(config, newTag, dryRun);

  // 4b. Generate changelog JSON if enabled
  const changelogJsonFiles: string[] = [];
  if (config.changelogJson.enabled) {
    for (const changelogPath of config.changelogPaths) {
      changelogJsonFiles.push(...generateChangelogJson(config, changelogPath, newTag, dryRun));
    }
  }

  // 5. Run format command, appending modified file paths
  const formatCommandStr = config.formatCommand ?? (hasPrettierConfig() ? 'npx prettier --write' : undefined);
  let formatCommand: PrepareResult['formatCommand'];

  if (formatCommandStr !== undefined) {
    const modifiedFiles = [
      ...config.packageFiles,
      ...config.changelogPaths.map((p) => `${p}/CHANGELOG.md`),
      ...changelogJsonFiles,
    ];
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
    workspaces: [
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
        commits,
        unparseableCommits,
        ...(setVersion === undefined ? {} : { setVersion }),
      },
    ],
    tags: [newTag],
    formatCommand,
    dryRun,
  };
}
