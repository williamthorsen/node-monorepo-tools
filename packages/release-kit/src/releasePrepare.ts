import { join as joinPath } from 'node:path';

import { buildChangelogEntries } from './buildChangelogEntries.ts';
import { buildEmptyReleaseEntry } from './buildEmptyReleaseEntry.ts';
import { buildReleaseSummary } from './buildReleaseSummary.ts';
import { mergeChangelogEntriesWithDisk, renderChangelogJson, resolveChangelogJsonPath } from './changelogJsonFile.ts';
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
import { planReleaseNotesPreviews } from './planReleaseNotesPreviews.ts';
import { planVersionBump, planVersionSet, type VersionBumpPlan } from './planVersionBump.ts';
import { readCurrentVersion } from './readCurrentVersion.ts';
import type { PlannedWrite, ReleasePlan } from './releasePlan.ts';
import { renderChangelogMarkdown } from './renderChangelogMarkdown.ts';
import { deriveSectionOrder } from './resolveReleaseNotesConfig.ts';
import type {
  ChangelogEntry,
  ChangelogOverride,
  Commit,
  PolicyViolation,
  ReleaseConfig,
  ReleasedWorkspaceResult,
  ReleaseType,
  SkippedWorkspaceResult,
} from './types.ts';

/**
 * Options for the release preparation workflow.
 *
 * Carries no dry-run flag: preparation only ever computes a plan, and whether that plan is
 * applied is the caller's decision.
 */
export interface ReleasePrepareOptions {
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
   * Workspace directories the run was narrowed to by `--only` (monorepo only), with
   * `config.workspaces` already filtered to match. Present only for a narrowed run, which
   * skips the project release: the project tier rolls up every contributing workspace, and
   * the narrowing has changed which workspaces those are.
   */
  only?: string[];
  /**
   * If true, write per-workspace release-notes previews under `{workspacePath}/docs/`
   * (`README.v{version}.md` and `RELEASE_NOTES.v{version}.md`) after each workspace's
   * `changelog.json` is produced. Requires `config.changelogJson.enabled`; when disabled,
   * a warning is recorded on the plan and no previews are generated.
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
export function releasePrepare(config: ReleaseConfig, options: ReleasePrepareOptions): ReleasePlan {
  const { bumpOverride, setVersion, withReleaseNotes } = options;
  const writes: PlannedWrite[] = [];
  const workTypes = config.workTypes ?? { ...DEFAULT_WORK_TYPES };
  const versionPatterns = config.versionPatterns ?? { ...DEFAULT_VERSION_PATTERNS };
  const breakingPolicies = config.breakingPolicies ?? DEFAULT_BREAKING_POLICIES;

  // Load editorial overrides for the project tier. Single-package mode collapses to one tier
  // (no workspaces to compose), so there's nothing to bundle into an `OverrideContext`.
  // Aborts the release on any malformed file before any writes — same upfront-failure
  // contract as the monorepo path, just over a single file.
  const overridesResult = loadOverridesForScopes({ project: '.' });
  if (overridesResult.errors.length > 0) {
    throw new Error(`Failed to load changelog overrides:\n  - ${overridesResult.errors.join('\n  - ')}`);
  }
  const overrides = overridesResult.project;

  // 1. Get commits since last tag
  const { tag, commits } = getCommitsSinceTarget([config.tagPrefix]);

  // 2. Determine bump type (or use the explicit setVersion bypass)
  let releaseType: ReleaseType | undefined;
  let parsedCommitCount: number | undefined;
  let unparseableCommits: Commit[] | undefined;
  const collector = createPolicyViolationCollector();
  let bump: VersionBumpPlan;

  if (setVersion !== undefined) {
    // Bypass commit-derived bump logic. Read the current version directly from the primary
    // package file so validation runs once, before any version write is planned.
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
    bump = planVersionSet(config.packageFiles, setVersion);
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
        writes: [],
        summary: '',
        formatCommand: undefined,
      };
    }

    // 3. Plan the version bumps.
    bump = planVersionBump(config.packageFiles, releaseType);
  }

  writes.push(...bump.writes);

  const newTag = `${config.tagPrefix}${bump.newVersion}`;

  // 4/4b. Generate the CHANGELOG.md files and (optionally) changelog.json. When the release
  // proceeds with zero qualifying commits since the last tag (`--force`, `--bump=X`, or
  // `--set-version` with no new commits), the routing helper bypasses git-cliff in favor
  // of the synthetic "Forced version bump." entry — issue #369.
  const planWarnings: string[] = [];
  const changelogs = planSinglePackageChangelogs({
    config,
    commits,
    newTag,
    newVersion: bump.newVersion,
    overrides,
    overrideWarnings: planWarnings,
  });
  const { changelogFiles, changelogJsonFiles } = changelogs;

  // 4c. Plan release-notes previews (optional, opt-in via --with-release-notes)
  const previewWrites = planSinglePackagePreviews(
    withReleaseNotes === true,
    config,
    newTag,
    changelogs.entries,
    planWarnings,
  );
  writes.push(...changelogs.writes, ...previewWrites);

  // 5. Render the format command over the modified file paths; the caller runs it once the
  // plan is on disk, since it reformats the very files the plan writes.
  const formatCommandStr = config.formatCommand ?? (hasPrettierConfig() ? 'npx prettier --write' : undefined);
  let formatCommand: ReleasePlan['formatCommand'];

  if (formatCommandStr !== undefined) {
    const modifiedFiles = [
      ...config.packageFiles,
      ...config.changelogPaths.map((changelogPath) => joinPath(changelogPath, 'CHANGELOG.md')),
      ...changelogJsonFiles,
    ];
    formatCommand = { command: `${formatCommandStr} ${modifiedFiles.join(' ')}`, files: modifiedFiles };
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
    previewFiles: previewWrites.map((write) => write.path),
  });

  const plan: ReleasePlan = {
    workspaces: [released],
    tags: [newTag],
    writes,
    summary: buildReleaseSummary({ workspaces: [released] }),
    formatCommand,
  };
  if (planWarnings.length > 0) {
    plan.warnings = planWarnings;
  }
  return plan;
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
  bump: VersionBumpPlan;
  newTag: string;
  changelogFiles: string[];
  previewFiles: string[];
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
    bumpedFiles: bump.writes.map((write) => write.path),
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
  if (args.previewFiles.length > 0) {
    released.previewFiles = args.previewFiles;
  }
  return released;
}

/** Inputs to {@link planSinglePackageChangelogs}. */
interface PlanSinglePackageChangelogsArgs {
  config: ReleaseConfig;
  commits: Commit[];
  newTag: string;
  newVersion: string;
  overrides: Map<string, ChangelogOverride>;
  /** Mutated in-place to surface override warnings (zero-match keys) on the plan. */
  overrideWarnings: string[];
}

/**
 * Single-package changelog planner. Builds entries (via cliff or synthetic empty-range), applies
 * editorial overrides, and renders both `changelog.json` and `CHANGELOG.md` from the merged set
 * so the two artifacts reflect the same post-override view.
 *
 * Override application errors abort the release; warnings (zero-match keys) are accumulated on
 * `overrideWarnings` so the caller can surface them on the plan.
 *
 * Returns the entries alongside the writes, so previews render from the same set.
 */
function planSinglePackageChangelogs(args: PlanSinglePackageChangelogsArgs): {
  changelogFiles: string[];
  changelogJsonFiles: string[];
  entries: ChangelogEntry[];
  writes: PlannedWrite[];
} {
  const { config, commits, newTag, newVersion, overrides, overrideWarnings } = args;
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
  const writes: PlannedWrite[] = [];
  let firstMergedEntries: ChangelogEntry[] = [];

  for (const changelogPath of config.changelogPaths) {
    const jsonPath = resolveChangelogJsonPath(config, changelogPath);
    // Merge with what is on disk so the markdown renderer sees prior entries. Only plan the
    // JSON write when `changelogJson.enabled`; when disabled the merge still runs, so the
    // markdown reflects the same set either way.
    const mergedEntries = mergeChangelogEntriesWithDisk(jsonPath, applied.entries);
    if (changelogFiles.length === 0) {
      firstMergedEntries = mergedEntries;
    }

    if (config.changelogJson.enabled) {
      writes.push({ path: jsonPath, content: renderChangelogJson(mergedEntries) });
      changelogJsonFiles.push(jsonPath);
    }

    const changelogFile = joinPath(changelogPath, 'CHANGELOG.md');
    writes.push({ path: changelogFile, content: renderChangelogMarkdown(mergedEntries, { sectionOrder }) });
    changelogFiles.push(changelogFile);
  }

  return { changelogFiles, changelogJsonFiles, entries: firstMergedEntries, writes };
}

/**
 * Plans the release-notes previews for a single-package workspace when the user requested them.
 *
 * Records a warning and plans nothing when `changelogJson.enabled` is false; plans nothing when no
 * changelog paths are configured, since there are then no entries to render.
 */
function planSinglePackagePreviews(
  withReleaseNotes: boolean,
  config: ReleaseConfig,
  newTag: string,
  entries: readonly ChangelogEntry[],
  warnings: string[],
): PlannedWrite[] {
  if (!withReleaseNotes) {
    return [];
  }
  if (!config.changelogJson.enabled) {
    warnings.push('--with-release-notes requires changelogJson.enabled; skipping preview generation');
    return [];
  }
  if (config.changelogPaths.length === 0) {
    return [];
  }

  const previews = planReleaseNotesPreviews({
    workspacePath: process.cwd(),
    tag: newTag,
    entries,
    sectionOrder: deriveSectionOrder(resolveWorkTypes(config.workTypes)),
  });
  warnings.push(...previews.warnings);

  return previews.writes;
}
