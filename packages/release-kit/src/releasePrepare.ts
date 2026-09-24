import { join as joinPath } from 'node:path';

import { attachChangelogDiagnostics } from './attachChangelogDiagnostics.ts';
import { readReleaseHistory, type ReleaseHistory, toReleaseEntries } from './buildChangelogEntries.ts';
import { buildReleaseSummary } from './buildReleaseSummary.ts';
import { mergeChangelogEntriesWithDisk, renderChangelogJson, resolveChangelogJsonPath } from './changelogJsonFile.ts';
import {
  applyChangelogOverrides,
  formatStaleOverrideKeyWarning,
  loadOverridesForScopes,
} from './changelogOverrides.ts';
import { decideRelease } from './decideRelease.ts';
import { hasPrettierConfig } from './hasPrettierConfig.ts';
import { resolveWorkTypes } from './loadConfig.ts';
import { planReleaseNotesPreviews } from './planReleaseNotesPreviews.ts';
import { planVersionBump, planVersionSet, type VersionBumpPlan } from './planVersionBump.ts';
import type { PlannedWrite, ReleasePlan } from './releasePlan.ts';
import { renderChangelogMarkdown } from './renderChangelogMarkdown.ts';
import { deriveSectionOrder } from './resolveReleaseNotesConfig.ts';
import type {
  ChangelogEntry,
  ChangelogOverride,
  PrepareConfig,
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
   * Release even when no commits or no bump-worthy commits exist since the last tag.
   * Orthogonal to `bumpOverride`: when `bumpOverride` is not given, the release falls back to `patch`.
   */
  force?: boolean;
  /** Choose the level of a release instead of the level that the changelog items call for; triggers no release. */
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
 * 1. Reads the release history once.
 * 2. Decides the release from the history's bump, `--force`, and `--bump` (or takes `--set-version`).
 * 3. Bumps all configured package.json version fields.
 * 4. Generates changelogs from the same history.
 * 5. Renders the optional format command.
 *
 * Returns a structured `PrepareResult` with all data needed for presentation.
 */
export function releasePrepare(config: PrepareConfig, options: ReleasePrepareOptions): ReleasePlan {
  const { bumpOverride, force, setVersion, withReleaseNotes } = options;
  const writes: PlannedWrite[] = [];

  // Load editorial overrides for the project tier. Single-package mode collapses to one tier
  // (no workspaces to compose), so there's nothing to bundle into an `OverrideContext`.
  // Aborts the release on any malformed file before any writes — same upfront-failure
  // contract as the monorepo path, just over a single file.
  const overridesResult = loadOverridesForScopes({ project: '.' });
  if (overridesResult.errors.length > 0) {
    throw new Error(`Failed to load changelog overrides:\n  - ${overridesResult.errors.join('\n  - ')}`);
  }
  const overrides = overridesResult.project;

  // 1. Read the release history once.
  const history = readReleaseHistory(config, { tagPrefixes: [config.tagPrefix] });
  const { commits } = history.unreleased;
  const tag = history.previousTag;
  const since = tag === undefined ? '(no previous release found)' : `since ${tag}`;

  // 2. Decide the release (or use the explicit setVersion bypass). `--bump=X` is purely a level
  //    chooser; `--force` is purely a release trigger that defaults to patch when no level is given.
  let releaseType: ReleaseType | undefined;
  let bump: VersionBumpPlan;

  if (setVersion === undefined) {
    const decision = decideRelease({
      naturalBump: history.unreleased.bump,
      commitCount: commits.length,
      force,
      bumpOverride,
      skipReasons: {
        noCommits: `No commits ${since}. Pass --force to release at patch. Skipping.`,
        noBumpWorthy: `No bump-worthy commits ${since}. Pass --force to release at patch (or --force --bump=X for a different level). Skipping.`,
      },
    });

    if (decision.outcome === 'skip') {
      const skipped = buildSkippedSinglePackage(history, decision.skipReason);
      return {
        workspaces: [skipped],
        tags: [],
        writes: [],
        summary: '',
        formatCommand: undefined,
      };
    }

    // 3. Plan the version bumps.
    releaseType = decision.releaseType;
    bump = planVersionBump(config.packageFiles, releaseType);
  } else {
    bump = planVersionSet(config.packageFiles, setVersion);
  }

  writes.push(...bump.writes);

  const newTag = `${config.tagPrefix}${bump.newVersion}`;

  // 4/4b. Generate the CHANGELOG.md files and (optionally) changelog.json. When the release
  // proceeds although its window yields no changelog item (`--force` or `--set-version`), the
  // planner records the synthetic "Forced version bump." entry for the new version.
  const planWarnings: string[] = [];
  const changelogs = planSinglePackageChangelogs({
    config,
    history,
    newTag,
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
    history,
    bump,
    newTag,
    changelogFiles,
    releaseType,
    bumpOverride: setVersion === undefined ? bumpOverride : undefined,
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

/**
 * Build a `SkippedWorkspaceResult` for the single-package skip path from the history that the
 * decision read, attaching only defined optional fields.
 */
function buildSkippedSinglePackage(history: ReleaseHistory, skipReason: string): SkippedWorkspaceResult {
  const { unreleased } = history;
  const skipped: SkippedWorkspaceResult = {
    status: 'skipped',
    commitCount: unreleased.commits.length,
    parsedCommitCount: unreleased.parsedCommitCount,
    skipReason,
  };
  if (history.previousTag !== undefined) {
    skipped.previousTag = history.previousTag;
  }
  if (unreleased.unparseableCommits !== undefined) {
    skipped.unparseableCommits = unreleased.unparseableCommits;
  }
  attachChangelogDiagnostics(skipped, unreleased.diagnostics);
  return skipped;
}

/** Inputs to {@link buildReleasedSinglePackage}. */
interface BuildReleasedSinglePackageArgs {
  history: ReleaseHistory;
  bump: VersionBumpPlan;
  newTag: string;
  changelogFiles: string[];
  previewFiles: string[];
  /** Undefined when `--set-version` chose the version, which also leaves the parse counts off the result. */
  releaseType: ReleaseType | undefined;
  bumpOverride: ReleaseType | undefined;
  setVersion: string | undefined;
}

/**
 * Construct a `ReleasedWorkspaceResult` for the single-package path, attaching only
 * defined optional fields. Extracted from `releasePrepare` to keep that function under
 * the project's cyclomatic-complexity ceiling — the conditional optional-field assignments
 * each contribute to complexity, and inlining them tips the host over the threshold.
 */
function buildReleasedSinglePackage(args: BuildReleasedSinglePackageArgs): ReleasedWorkspaceResult {
  const { history, bump, newTag, changelogFiles, releaseType, bumpOverride, setVersion } = args;
  const { commits, diagnostics, parsedCommitCount, unparseableCommits } = history.unreleased;
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
  if (history.previousTag !== undefined) {
    released.previousTag = history.previousTag;
  }
  if (releaseType !== undefined) {
    released.releaseType = releaseType;
    released.parsedCommitCount = parsedCommitCount;
    if (unparseableCommits !== undefined) {
      released.unparseableCommits = unparseableCommits;
    }
  }
  if (bumpOverride !== undefined) {
    released.bumpOverride = bumpOverride;
  }
  attachChangelogDiagnostics(released, diagnostics);
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
  config: PrepareConfig;
  history: ReleaseHistory;
  newTag: string;
  overrides: Map<string, ChangelogOverride>;
  /** Mutated in-place to surface override warnings (zero-match keys) on the plan. */
  overrideWarnings: string[];
}

/**
 * Single-package changelog planner. Builds entries (from release windows, or the synthetic entry when the unreleased window yields no item), applies
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
  const { config, history, newTag, overrides, overrideWarnings } = args;
  const today = new Date().toISOString().slice(0, 10);

  const builtEntries = toReleaseEntries(history, newTag, today);
  const applied = applyChangelogOverrides(builtEntries, overrides);
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
  config: PrepareConfig,
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
