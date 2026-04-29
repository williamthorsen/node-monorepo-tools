import { execSync } from 'node:child_process';

import { bumpAllVersions, setAllVersions } from './bumpAllVersions.ts';
import { isForwardVersion } from './compareVersions.ts';
import { DEFAULT_VERSION_PATTERNS, DEFAULT_WORK_TYPES } from './defaults.ts';
import { determineBumpFromCommits } from './determineBumpFromCommits.ts';
import { generateChangelogJson } from './generateChangelogJson.ts';
import { generateChangelogs } from './generateChangelogs.ts';
import { getCommitsSinceTarget } from './getCommitsSinceTarget.ts';
import { hasPrettierConfig } from './hasPrettierConfig.ts';
import { resolveWorkTypes } from './loadConfig.ts';
import { readCurrentVersion } from './readCurrentVersion.ts';
import { deriveSectionOrder } from './resolveReleaseNotesConfig.ts';
import type {
  BumpResult,
  Commit,
  PrepareResult,
  ReleaseConfig,
  ReleasedWorkspaceResult,
  ReleaseType,
  SkippedWorkspaceResult,
} from './types.ts';
import { writeReleaseNotesPreviews } from './writeReleaseNotesPreviews.ts';

/** Options for the release preparation workflow. */
export interface ReleasePrepareOptions {
  /** If true, logs actions without modifying files. */
  dryRun: boolean;
  /**
   * Release even when no commits or no bump-worthy commits exist since the last tag
   * (monorepo only). Orthogonal to `bumpOverride`: when `bumpOverride` is not given,
   * the release falls back to `patch`.
   */
  force?: boolean;
  /** Override the bump type instead of determining it from commits. */
  bumpOverride?: ReleaseType;
  /**
   * Explicit target version (canonical `N.N.N`) that bypasses commit-derived bump logic.
   * Mutually exclusive with `bumpOverride`. In monorepo mode the caller must narrow
   * `config.workspaces` to a single workspace before invoking.
   */
  setVersion?: string;
  /**
   * If true, write per-workspace release-notes previews under `{workspacePath}/docs/`
   * (`README.v{version}.md` and `RELEASE_NOTES.v{version}.md`) after each workspace's
   * `changelog.json` is produced. Requires `config.changelogJson.enabled`; when disabled,
   * a warning is logged and no previews are generated.
   */
  withReleaseNotes?: boolean;
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
  const { dryRun, bumpOverride, setVersion, withReleaseNotes } = options;
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
      const skipped: SkippedWorkspaceResult = {
        status: 'skipped',
        commitCount: commits.length,
        skipReason: 'No release-worthy changes found. Skipping.',
      };
      if (tag !== undefined) {
        skipped.previousTag = tag;
      }
      if (parsedCommitCount !== undefined) {
        skipped.parsedCommitCount = parsedCommitCount;
      }
      if (unparseableCommits !== undefined) {
        skipped.unparseableCommits = unparseableCommits;
      }
      return {
        workspaces: [skipped],
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

  // 4c. Write release-notes previews (optional, opt-in via --with-release-notes)
  maybeWriteSinglePackagePreviews(withReleaseNotes === true, config, newTag, changelogJsonFiles[0], dryRun);

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
        const baseMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`format stage: ${baseMessage} (command: '${fullCommand}')`, { cause: error });
      }
      formatCommand = { command: fullCommand, executed: true, files: modifiedFiles };
    }
  }

  const released = buildReleasedSinglePackage({
    commits,
    bump,
    newTag,
    changelogFiles,
    previousTag: tag,
    parsedCommitCount,
    releaseType,
    unparseableCommits,
    setVersion,
  });

  return {
    workspaces: [released],
    tags: [newTag],
    formatCommand,
    dryRun,
  };
}

/** Inputs to {@link buildReleasedSinglePackage}. */
interface BuildReleasedSinglePackageArgs {
  commits: Commit[];
  bump: BumpResult;
  newTag: string;
  changelogFiles: string[];
  previousTag: string | undefined;
  parsedCommitCount: number | undefined;
  releaseType: ReleaseType | undefined;
  unparseableCommits: Commit[] | undefined;
  setVersion: string | undefined;
}

/**
 * Construct a `ReleasedWorkspaceResult` for the single-package path, attaching only
 * defined optional fields. Extracted from `releasePrepare` to keep that function under
 * the project's cyclomatic-complexity ceiling — the conditional optional-field assignments
 * each contribute to complexity, and inlining them tips the host over the threshold.
 */
function buildReleasedSinglePackage(args: BuildReleasedSinglePackageArgs): ReleasedWorkspaceResult {
  const {
    commits,
    bump,
    newTag,
    changelogFiles,
    previousTag,
    parsedCommitCount,
    releaseType,
    unparseableCommits,
    setVersion,
  } = args;
  const released: ReleasedWorkspaceResult = {
    status: 'released',
    commitCount: commits.length,
    currentVersion: bump.currentVersion,
    newVersion: bump.newVersion,
    tag: newTag,
    bumpedFiles: bump.files,
    changelogFiles,
    commits,
  };
  if (previousTag !== undefined) {
    released.previousTag = previousTag;
  }
  if (parsedCommitCount !== undefined) {
    released.parsedCommitCount = parsedCommitCount;
  }
  if (releaseType !== undefined) {
    released.releaseType = releaseType;
  }
  if (unparseableCommits !== undefined) {
    released.unparseableCommits = unparseableCommits;
  }
  if (setVersion !== undefined) {
    released.setVersion = setVersion;
  }
  return released;
}

/**
 * Invoke `writeReleaseNotesPreviews` for a single-package workspace when the user requested
 * previews. Warns and returns when `changelogJson.enabled` is false; silently returns when no
 * changelog JSON file was produced (e.g., no changelog paths configured).
 */
function maybeWriteSinglePackagePreviews(
  withReleaseNotes: boolean,
  config: ReleaseConfig,
  newTag: string,
  changelogJsonPath: string | undefined,
  dryRun: boolean,
): void {
  if (!withReleaseNotes) {
    return;
  }
  if (!config.changelogJson.enabled) {
    console.warn('Warning: --with-release-notes requires changelogJson.enabled; skipping preview generation');
    return;
  }
  if (changelogJsonPath === undefined) {
    return;
  }
  writeReleaseNotesPreviews({
    workspacePath: process.cwd(),
    tag: newTag,
    changelogJsonPath,
    sectionOrder: deriveSectionOrder(resolveWorkTypes(config.workTypes)),
    dryRun,
  });
}
