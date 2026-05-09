import { execSync } from 'node:child_process';

import { buildChangelogEntries } from './buildChangelogEntries.ts';
import { buildEmptyReleaseEntry } from './buildEmptyReleaseEntry.ts';
import { bumpAllVersions, setAllVersions } from './bumpAllVersions.ts';
import {
  mergeChangelogEntriesWithDisk,
  resolveChangelogJsonPath,
  upsertChangelogJsonAndReturn,
} from './changelogJsonFile.ts';
import {
  applyChangelogOverrides,
  formatStaleOverrideKeyWarning,
  loadOverridesForScopes,
} from './changelogOverrides.ts';
import { createPolicyViolationCollector } from './collectPolicyViolations.ts';
import { isForwardVersion } from './compareVersions.ts';
import { DEFAULT_BREAKING_POLICIES, DEFAULT_VERSION_PATTERNS, DEFAULT_WORK_TYPES } from './defaults.ts';
import { determineBumpFromCommits } from './determineBumpFromCommits.ts';
import { getCommitsSinceTarget } from './getCommitsSinceTarget.ts';
import { hasPrettierConfig } from './hasPrettierConfig.ts';
import { resolveWorkTypes } from './loadConfig.ts';
import { readCurrentVersion } from './readCurrentVersion.ts';
import { writeChangelogMarkdown } from './renderChangelogMarkdown.ts';
import { deriveSectionOrder } from './resolveReleaseNotesConfig.ts';
import { refreshGitCliffCache } from './runGitCliff.ts';
import type {
  BumpResult,
  ChangelogOverride,
  Commit,
  PolicyViolation,
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
  const breakingPolicies = config.breakingPolicies ?? DEFAULT_BREAKING_POLICIES;
  const overrides = loadProjectOverridesOrThrow();

  // 1. Get commits since last tag
  const { tag, commits } = getCommitsSinceTarget([config.tagPrefix]);

  // 2. Determine bump type (or use the explicit setVersion bypass)
  let releaseType: ReleaseType | undefined;
  let parsedCommitCount: number | undefined;
  let unparseableCommits: Commit[] | undefined;
  const collector = createPolicyViolationCollector();
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
    // Warm the git-cliff cache *before* writing any package.json bumps so a refresh failure
    // leaves the working tree unchanged.
    refreshGitCliffCache();
    bump = setAllVersions(config.packageFiles, setVersion, dryRun);
  } else {
    if (bumpOverride === undefined) {
      const determination = determineBumpFromCommits(commits, workTypes, versionPatterns, config.scopeAliases, {
        breakingPolicies,
        onPolicyViolation: collector.onPolicyViolation,
      });
      parsedCommitCount = determination.parsedCommitCount;
      unparseableCommits = determination.unparseableCommits;
      releaseType = determination.releaseType;
    } else {
      releaseType = bumpOverride;
    }

    if (releaseType === undefined) {
      const skipped = buildSkippedSinglePackage({
        commitCount: commits.length,
        previousTag: tag,
        parsedCommitCount,
        unparseableCommits,
        policyViolations: collector.violations.length > 0 ? collector.violations : undefined,
      });
      return {
        workspaces: [skipped],
        tags: [],
        dryRun,
      };
    }

    // 3. Bump all versions. Warm the git-cliff cache *before* writing any bumps so a
    // refresh failure leaves the working tree unchanged. The `--prefer-offline` flag in
    // `runGitCliff` would otherwise pin the cached binary forever; one warmup per run
    // revalidates it without losing the per-call perf win.
    refreshGitCliffCache();
    bump = bumpAllVersions(config.packageFiles, releaseType, dryRun);
  }

  const newTag = `${config.tagPrefix}${bump.newVersion}`;

  // 4/4b. Generate the CHANGELOG.md files and (optionally) changelog.json. When the release
  // proceeds with zero qualifying commits since the last tag (`--force`, `--bump=X`, or
  // `--set-version` with no new commits), the routing helper bypasses git-cliff in favor
  // of the synthetic "Forced version bump." entry — issue #369.
  const overrideWarnings: string[] = [];
  const { changelogFiles, changelogJsonFiles } = writeSinglePackageChangelogs({
    config,
    commits,
    newTag,
    newVersion: bump.newVersion,
    dryRun,
    overrides,
    overrideWarnings,
  });

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
    policyViolations: collector.violations.length > 0 ? collector.violations : undefined,
    setVersion,
  });

  const result: PrepareResult = {
    workspaces: [released],
    tags: [newTag],
    formatCommand,
    dryRun,
  };
  if (overrideWarnings.length > 0) {
    result.warnings = overrideWarnings;
  }
  return result;
}

/**
 * Load the project-tier `.meta/changelog-overrides.json` (relative to `process.cwd()`).
 *
 * Single-package mode collapses to one tier — there's no monorepo workspace structure, so
 * there's nothing to compose. Aborts the release with a clear error when the file is
 * malformed or any per-entry validation fails; checked-in editorial config that does not
 * parse is a bug, not a warning.
 */
function loadProjectOverridesOrThrow(): Map<string, ChangelogOverride> {
  const result = loadOverridesForScopes({ project: '.' });
  if (result.errors.length > 0) {
    throw new Error(`Failed to load changelog overrides:\n  - ${result.errors.join('\n  - ')}`);
  }
  return result.project;
}

/** Inputs to {@link buildSkippedSinglePackage}. */
interface BuildSkippedSinglePackageArgs {
  commitCount: number;
  previousTag: string | undefined;
  parsedCommitCount: number | undefined;
  unparseableCommits: Commit[] | undefined;
  policyViolations: PolicyViolation[] | undefined;
}

/**
 * Build a `SkippedWorkspaceResult` for the single-package "no release-worthy changes" path,
 * attaching only defined optional fields. Extracted from `releasePrepare` so the host stays
 * within the project's cyclomatic-complexity ceiling — each conditional optional-field
 * assignment is one branch.
 */
function buildSkippedSinglePackage(args: BuildSkippedSinglePackageArgs): SkippedWorkspaceResult {
  const skipped: SkippedWorkspaceResult = {
    status: 'skipped',
    commitCount: args.commitCount,
    skipReason: 'No release-worthy changes found. Skipping.',
  };
  if (args.previousTag !== undefined) {
    skipped.previousTag = args.previousTag;
  }
  if (args.parsedCommitCount !== undefined) {
    skipped.parsedCommitCount = args.parsedCommitCount;
  }
  if (args.unparseableCommits !== undefined) {
    skipped.unparseableCommits = args.unparseableCommits;
  }
  if (args.policyViolations !== undefined) {
    skipped.policyViolations = args.policyViolations;
  }
  return skipped;
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
  policyViolations: PolicyViolation[] | undefined;
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
    policyViolations,
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
  if (policyViolations !== undefined) {
    released.policyViolations = policyViolations;
  }
  if (setVersion !== undefined) {
    released.setVersion = setVersion;
  }
  return released;
}

/** Inputs to {@link writeSinglePackageChangelogs}. */
interface WriteSinglePackageChangelogsArgs {
  config: ReleaseConfig;
  commits: Commit[];
  newTag: string;
  newVersion: string;
  dryRun: boolean;
  overrides: Map<string, ChangelogOverride>;
  /** Mutated in-place to surface override warnings (zero-match keys) on the `PrepareResult`. */
  overrideWarnings: string[];
}

/**
 * Single-package changelog writer. Builds entries (via cliff or synthetic empty-range),
 * applies editorial overrides, persists the merged JSON, and renders `CHANGELOG.md` from
 * the merged set so both artifacts reflect the same post-override view.
 *
 * Override application errors abort the release; warnings (zero-match keys) are accumulated
 * on `overrideWarnings` so the caller can surface them on `PrepareResult.warnings`.
 */
function writeSinglePackageChangelogs(args: WriteSinglePackageChangelogsArgs): {
  changelogFiles: string[];
  changelogJsonFiles: string[];
} {
  const { config, commits, newTag, newVersion, dryRun, overrides, overrideWarnings } = args;
  const isEmptyRange = commits.length === 0;
  const today = new Date().toISOString().slice(0, 10);

  const baseEntries = isEmptyRange
    ? [buildEmptyReleaseEntry(newVersion, today)]
    : buildChangelogEntries(config, newTag);
  const applied = applyChangelogOverrides(baseEntries, overrides);
  if (applied.errors.length > 0) {
    throw new Error(`Changelog override application failed:\n  - ${applied.errors.join('\n  - ')}`);
  }
  overrideWarnings.push(...applied.warnings);
  // Single-package: a key that didn't match this batch is genuinely stale (no other batches).
  const matchedSet = new Set(applied.matchedKeys);
  for (const overrideKey of overrides.keys()) {
    if (!matchedSet.has(overrideKey)) {
      overrideWarnings.push(formatStaleOverrideKeyWarning(overrideKey));
    }
  }

  const sectionOrder = deriveSectionOrder(resolveWorkTypes(config.workTypes));
  const changelogFiles: string[] = [];
  const changelogJsonFiles: string[] = [];

  for (const changelogPath of config.changelogPaths) {
    const jsonPath = resolveChangelogJsonPath(config, changelogPath);
    // Only write `changelog.json` when `changelogJson.enabled`. When disabled (or dry-run), use
    // the pure read-and-merge path so the markdown renderer still sees prior on-disk entries
    // without creating or modifying the JSON file.
    const shouldWriteJson = config.changelogJson.enabled && !dryRun;
    const mergedEntries = shouldWriteJson
      ? upsertChangelogJsonAndReturn(jsonPath, applied.entries)
      : mergeChangelogEntriesWithDisk(jsonPath, applied.entries);

    if (config.changelogJson.enabled) {
      changelogJsonFiles.push(jsonPath);
    }

    changelogFiles.push(
      writeChangelogMarkdown({
        changelogPath,
        entries: mergedEntries,
        sectionOrder,
        dryRun,
      }),
    );
  }

  return { changelogFiles, changelogJsonFiles };
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
