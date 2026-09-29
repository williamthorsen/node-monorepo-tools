import { join as joinPath } from 'node:path';

import { assertTaggedBaseline, findUntaggedBaseline } from './assertTaggedBaseline.ts';
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
import { deriveSectionOrder } from './deriveReleaseNotesConfig.ts';
import { hasPrettierConfig } from './hasPrettierConfig.ts';
import { resolveWorkTypes } from './loadConfig.ts';
import { planReleaseNotesPreviews } from './planReleaseNotesPreviews.ts';
import { planVersionBump, planVersionSet, type VersionBumpPlan } from './planVersionBump.ts';
import { planPreservedSections } from './readChangelogSections.ts';
import type { PlannedWrite, ReleasePlan } from './releasePlan.ts';
import { renderChangelogMarkdown } from './renderChangelogMarkdown.ts';
import type {
  ChangelogEntry,
  ChangelogOverride,
  ChangelogPreservation,
  PrepareConfig,
  ReleasedWorkspaceResult,
  ReleaseType,
  SkippedWorkspaceResult,
} from './types.ts';

/** Options for the release preparation workflow. */
export interface ReleasePrepareOptions {
  /**
   * Release even when the range since the last tag doesn't contain any commits or any bump-worthy commits.
   * Orthogonal to `bumpOverride`: When `bumpOverride` is not given, the release falls back to `patch`.
   */
  force?: boolean;
  /** Level of the release, in place of the level that the changelog items call for; it doesn't trigger a release. */
  bumpOverride?: ReleaseType;
  /**
   * Explicit target version (canonical `N.N.N`) that bypasses commit-derived bump logic.
   * Mutually exclusive with `bumpOverride`. In monorepo mode the caller must narrow
   * `config.workspaces` to a single workspace before invoking.
   */
  setVersion?: string;
  /**
   * Workspace directories to which `--only` narrowed the run (monorepo only), with
   * `config.workspaces` already filtered to match. Present only for a narrowed run, which
   * skips the project release: The project tier rolls up every contributing workspace, and
   * the narrowing has changed which workspaces those are.
   */
  only?: string[];
  /**
   * Every configured workspace `dir`, taken before `--only` narrowed `config.workspaces`; the unrouted-scope report
   * does not report a scope naming one of them that the run did not read. Defaults to the `dir`s of
   * `config.workspaces`.
   */
  configuredWorkspaceDirs?: readonly string[];
  /**
   * If true, plan per-workspace release-notes previews under `{workspacePath}/docs/`
   * (`README.v{version}.md` and `RELEASE_NOTES.v{version}.md`) from each workspace's
   * changelog entries. Requires `config.changelogJson.enabled`; when disabled,
   * the planner records a warning on the plan and doesn't plan any previews.
   */
  withReleaseNotes?: boolean;
}

/**
 * Orchestrates the release preparation workflow for a single package.
 *
 * 1. Reads the release history once, and stops when the current version is recorded but untagged.
 * 2. Decides the release from the history's bump, `--force`, and `--bump` (or takes `--set-version`).
 * 3. Plans the bump of every configured `package.json` version field.
 * 4. Plans the changelogs from the same history, and the release-notes previews when requested.
 * 5. Renders the optional format command.
 *
 * Returns the plan without writing any file.
 */
export function releasePrepare(config: PrepareConfig, options: ReleasePrepareOptions): ReleasePlan {
  const { bumpOverride, force, setVersion, withReleaseNotes } = options;
  const writes: PlannedWrite[] = [];

  // Load the project tier's editorial overrides, aborting on a malformed file before anything is planned.
  const overridesResult = loadOverridesForScopes({ project: '.' });
  if (overridesResult.errors.length > 0) {
    throw new Error(`Failed to load changelog overrides:\n  - ${overridesResult.errors.join('\n  - ')}`);
  }
  const overrides = overridesResult.project;

  // 1. Read the release history once.
  const history = readReleaseHistory(config, { tagPrefixes: [config.tagPrefix] });
  assertTaggedBaseline([
    findUntaggedBaseline(
      {
        label: 'package',
        packageFiles: config.packageFiles,
        changelogPaths: config.changelogPaths,
        tagPrefixes: [config.tagPrefix],
        previousTag: history.previousTag,
      },
      config,
    ),
  ]);
  const { commits } = history.unreleased;
  const tag = history.previousTag;
  const since = tag === undefined ? '(no previous release found)' : `since ${tag}`;

  // 2. Decide the release (or use the explicit setVersion bypass). `--bump=X` is purely a level
  //    chooser; `--force` is purely a release trigger that defaults to patch when `--bump` is absent.
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

  // 4. Generate the CHANGELOG.md files and (optionally) changelog.json. When the release
  // proceeds although its window doesn't yield any changelog item (`--force` or `--set-version`),
  // the planner records the synthetic "Forced version bump." entry for the new version.
  const planWarnings: string[] = [];
  const changelogs = planSinglePackageChangelogs({
    config,
    history,
    newTag,
    overrides,
    overrideWarnings: planWarnings,
  });
  const { changelogFiles, changelogJsonFiles, changelogPreservation } = changelogs;

  const previewWrites = planSinglePackagePreviews(
    withReleaseNotes === true,
    config,
    newTag,
    changelogs.entries,
    planWarnings,
  );
  writes.push(...changelogs.writes, ...previewWrites);

  // 5. Render the format command over the modified file paths; the caller runs it once the
  // plan is on disk, since it reformats the very files that the plan writes.
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
    changelogPreservation,
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
 * Builds a `SkippedWorkspaceResult` for the single-package skip path from the history that the
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
  changelogPreservation: ChangelogPreservation[];
  previewFiles: string[];
  /** Undefined when `--set-version` chose the version, which also leaves the parse counts off the result. */
  releaseType: ReleaseType | undefined;
  bumpOverride: ReleaseType | undefined;
  setVersion: string | undefined;
}

/**
 * Constructs a `ReleasedWorkspaceResult` for the single-package path, attaching only
 * defined optional fields.
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
  if (args.changelogPreservation.length > 0) {
    released.changelogPreservation = args.changelogPreservation;
  }
  return released;
}

/** Inputs to {@link planSinglePackageChangelogs}. */
interface PlanSinglePackageChangelogsArgs {
  config: PrepareConfig;
  history: ReleaseHistory;
  newTag: string;
  overrides: Map<string, ChangelogOverride>;
  /** Mutated in-place to collect override warnings (zero-match keys) for the plan. */
  overrideWarnings: string[];
}

/**
 * Builds the single-package changelog entries (from release windows, or the synthetic entry when the unreleased window
 * doesn't yield any item), applies editorial overrides, and renders both `changelog.json` and `CHANGELOG.md` from the
 * merged set so that the two files reflect the same post-override view. `CHANGELOG.md` also keeps the existing sections
 * whose versions the merged set lacks.
 *
 * Override application errors abort the release; warnings (zero-match and stale keys) are accumulated on
 * `overrideWarnings` so that the caller can add them to the plan.
 *
 * Returns the entries alongside the writes, so that previews render from the same set.
 */
function planSinglePackageChangelogs(args: PlanSinglePackageChangelogsArgs): {
  changelogFiles: string[];
  changelogJsonFiles: string[];
  changelogPreservation: ChangelogPreservation[];
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
  // Single-package: A key that didn't match this batch is genuinely stale (this run doesn't have any other batch).
  const matchedSet = new Set(applied.matchedKeys);
  for (const overrideKey of overrides.keys()) {
    if (!matchedSet.has(overrideKey)) {
      overrideWarnings.push(formatStaleOverrideKeyWarning(overrideKey));
    }
  }

  const sectionOrder = deriveSectionOrder(resolveWorkTypes(config.workTypes));
  const changelogFiles: string[] = [];
  const changelogJsonFiles: string[] = [];
  const changelogPreservation: ChangelogPreservation[] = [];
  const writes: PlannedWrite[] = [];
  let firstMergedEntries: ChangelogEntry[] = [];

  for (const changelogPath of config.changelogPaths) {
    const jsonPath = resolveChangelogJsonPath(config, changelogPath);
    // Merge with the entries on disk so that the markdown includes prior releases, whether or not the JSON is written.
    const mergedEntries = mergeChangelogEntriesWithDisk(jsonPath, applied.entries);
    if (changelogFiles.length === 0) {
      firstMergedEntries = mergedEntries;
    }

    if (config.changelogJson.enabled) {
      writes.push({ path: jsonPath, content: renderChangelogJson(mergedEntries) });
      changelogJsonFiles.push(jsonPath);
    }

    const changelogFile = joinPath(changelogPath, 'CHANGELOG.md');
    const preserved = planPreservedSections(changelogFile, mergedEntries);
    writes.push({
      path: changelogFile,
      content: renderChangelogMarkdown(mergedEntries, { sectionOrder, preservedSections: preserved.sections }),
    });
    changelogFiles.push(changelogFile);
    if (preserved.preservation !== undefined) {
      changelogPreservation.push(preserved.preservation);
    }
  }

  return { changelogFiles, changelogJsonFiles, changelogPreservation, entries: firstMergedEntries, writes };
}

/**
 * Plans the release-notes previews for a single-package workspace when the user requested them.
 *
 * Records a warning and plans nothing when `changelogJson.enabled` is false; plans nothing when the
 * config doesn't list any changelog paths, since it then doesn't have any entries to render.
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
    workspacePath: '.',
    tag: newTag,
    entries,
    sectionOrder: deriveSectionOrder(resolveWorkTypes(config.workTypes)),
  });
  warnings.push(...previews.warnings);

  return previews.writes;
}
