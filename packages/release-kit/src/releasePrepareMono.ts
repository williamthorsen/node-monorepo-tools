import { join as joinPath } from 'node:path';

import { chainError } from '@williamthorsen/toolbelt.errors/candidate';

import { assertTaggedBaseline, findUntaggedBaseline, type UntaggedBaseline } from './assertTaggedBaseline.ts';
import { attachChangelogDiagnostics } from './attachChangelogDiagnostics.ts';
import { readReleaseHistory, type ReleaseHistory, toReleaseEntries } from './buildChangelogEntries.ts';
import { buildDependencyGraph, type DependencyGraph } from './buildDependencyGraph.ts';
import { buildReleaseSummary } from './buildReleaseSummary.ts';
import { buildSyntheticChangelogEntry } from './buildSyntheticChangelogEntry.ts';
import { mergeChangelogEntriesWithDisk, renderChangelogJson, resolveChangelogJsonPath } from './changelogJsonFile.ts';
import {
  applyWorkspaceOverrides,
  createOverrideContext,
  formatStaleOverrideKeyWarning,
  type OverrideContext,
} from './changelogOverrides.ts';
import { decideRelease } from './decideRelease.ts';
import { deriveSectionOrder } from './deriveReleaseNotesConfig.ts';
import { detectUndeclaredTagPrefixes } from './detectUndeclaredTagPrefixes.ts';
import { findUnroutedEntryScopes } from './findUnroutedEntryScopes.ts';
import { getAllTagPrefixes } from './generateChangelogs.ts';
import { hasPrettierConfig } from './hasPrettierConfig.ts';
import { resolveWorkTypes } from './loadConfig.ts';
import { planReleaseNotesPreviews } from './planReleaseNotesPreviews.ts';
import { planVersionBump, planVersionSet } from './planVersionBump.ts';
import { propagateBumps, type ReleaseEntry } from './propagateBumps.ts';
import { planPreservedSections } from './readChangelogSections.ts';
import type { PlannedWrite, ReleasePlan } from './releasePlan.ts';
import type { ReleasePrepareOptions } from './releasePrepare.ts';
import { releasePrepareProject } from './releasePrepareProject.ts';
import { renderChangelogMarkdown } from './renderChangelogMarkdown.ts';
import type {
  ChangelogEntry,
  ChangelogPreservation,
  MonorepoPrepareConfig,
  ProjectPrepareResult,
  ReleasedWorkspaceResult,
  ReleaseType,
  SkippedWorkspaceResult,
  WorkspaceConfig,
  WorkspacePrepareResult,
} from './types.ts';

/** Intermediate result from Phase 1 (determine direct bumps). */
interface DirectBumpResult {
  workspace: WorkspaceConfig;
  /** The workspace's one read of its release windows, from which Phase 3 builds its changelog entries. */
  history: ReleaseHistory;
  /** Release type from the decision. Undefined when `setVersion` is used. */
  releaseType: ReleaseType | undefined;
  /** Set when `--bump=X` was supplied for this workspace's direct release. */
  bumpOverride: ReleaseType | undefined;
  /** Explicit version from `--set-version`, present only for the overridden workspace. */
  setVersion?: string;
}

/** Intermediate result for a skipped workspace. */
interface SkippedResult {
  workspace: WorkspaceConfig;
  history: ReleaseHistory;
  skipReason: string;
}

/** Aggregate result from Phase 1 (determine direct bumps). */
interface Phase1Result {
  directBumps: Map<string, ReleaseEntry>;
  directResults: Map<string, DirectBumpResult>;
  skippedResults: SkippedResult[];
  /** Untagged baselines, keyed by workspace `dir`. */
  untaggedBaselines: Map<string, UntaggedBaseline>;
}

/**
 * Orchestrates release preparation for a monorepo with multiple workspaces.
 *
 * Phase 1: Determines direct bumps from commits for each workspace.
 * Phase 2: Builds the dependency graph and propagates bumps to dependents.
 * Phase 2b: Sorts the full release set topologically.
 * Phase 3: Plans bumps and changelogs in dependency order.
 * Phase 3b: Plans the project release.
 * Phase 4: Renders the format command.
 */
export function releasePrepareMono(config: MonorepoPrepareConfig, options: ReleasePrepareOptions): ReleasePlan {
  const { only, withReleaseNotes } = options;
  const writes: PlannedWrite[] = [];
  const warnings: string[] = [];

  if (withReleaseNotes === true && !config.changelogJson.enabled) {
    warnings.push('--with-release-notes requires changelogJson.enabled; skipping preview generation');
  }

  const sectionOrder = deriveSectionOrder(resolveWorkTypes(config.workTypes));

  // Load editorial overrides once per run (root file plus every workspace file); a malformed file aborts the release
  // before anything is planned.
  const overrideContext = createOverrideContext(config.workspaces);

  // === Phase 1: Determine direct bumps ===
  const { directBumps, directResults, skippedResults, untaggedBaselines } = determineDirectBumps(config, options);
  reportUnroutedEntryScopes([...directResults.values(), ...skippedResults], config, options);

  // Keep each skipped workspace's history for when propagation promotes it to a release.
  const skippedHistories = new Map(skippedResults.map((skipped) => [skipped.workspace.dir, skipped.history]));

  // === Phase 2: Build graph and propagate bumps ===
  const graph = buildDependencyGraph(config.workspaces);
  const fullReleaseSet = propagateBumps(directBumps, graph);

  // A workspace that releases through propagation alone doesn't render any entry from its window, so its baseline does
  // not matter. Throw outside `tryStage` so that one error names every other workspace's missing tag.
  assertTaggedBaseline(
    [...untaggedBaselines]
      .filter(([dir]) => directBumps.has(dir) || !fullReleaseSet.has(dir))
      .map(([, untagged]) => untagged),
  );

  // === Phase 2b: Topologically sort the release set ===
  const { sorted: sortedDirs, cyclicDirs } = topologicalSort(fullReleaseSet, graph);
  if (cyclicDirs.length > 0) {
    warnings.push(
      `Circular workspace dependencies detected among: ${cyclicDirs.join(', ')}. ` +
        'Propagation metadata may be incomplete for these workspaces.',
    );
  }

  // === Phase 3: Execute bumps and generate changelogs ===
  const workspaces = collectSkippedWorkspaces(skippedResults, fullReleaseSet);
  const previewOptions: PreviewOptions = {
    enabled: withReleaseNotes === true && config.changelogJson.enabled,
    sectionOrder,
  };
  const { tags, modifiedFiles } = executeReleaseSet({
    sortedDirs,
    fullReleaseSet,
    config,
    directResults,
    skippedHistories,
    writes,
    warnings,
    workspaces,
    previewOptions,
    overrideContext,
    sectionOrder,
  });

  // Reorder workspaces to match original config order.
  const configOrder = new Map(config.workspaces.map((w, i) => [w.dir, i]));
  workspaces.sort((a, b) => {
    const orderA = configOrder.get(a.name ?? '') ?? 0;
    const orderB = configOrder.get(b.name ?? '') ?? 0;
    return orderA - orderB;
  });

  // === Phase 3b: Project release ===
  // Runs after the per-workspace loop, so that the contributing workspaces are settled, and before
  // `planFormatCommand`, so that the format command covers the root files. A narrowed run skips the
  // stage: The project release rolls up every contributing workspace, and `--only` has changed
  // which workspaces those are.
  //
  // `project` stays undefined when the config lacks a project block or `--only` narrowed the run.
  let project: ProjectPrepareResult | undefined;
  if (config.project !== undefined) {
    if (only === undefined) {
      project = tryStage('project release stage', () =>
        releasePrepareProject({
          config,
          options,
          modifiedFiles,
          writes,
          tags,
          warnings,
          rootOverrides: overrideContext.project,
          overrideWarnings: overrideContext.overrideWarnings,
          globalMatchedRootKeys: overrideContext.globalMatchedRootKeys,
        }),
      );
    } else {
      warnings.push(
        `Project release skipped: --only narrows this run to ${only.join(', ')}. ` +
          'Run `release-kit prepare` without --only to include the project release.',
      );
    }
  }

  // === Phase 4: Render the format command ===
  const formatCommand = planFormatCommand(config, tags, modifiedFiles);

  // Warn once per root key that did not match in any workspace or project apply call. Each workspace's apply call
  // already warned about that workspace's own stale keys.
  for (const overrideKey of overrideContext.project.keys()) {
    if (!overrideContext.globalMatchedRootKeys.has(overrideKey)) {
      overrideContext.overrideWarnings.push(formatStaleOverrideKeyWarning(overrideKey));
    }
  }

  const allWarnings = [...warnings, ...overrideContext.overrideWarnings];

  return {
    workspaces,
    tags,
    writes,
    summary: buildReleaseSummary({ workspaces, ...(project !== undefined && { project }) }),
    formatCommand,
    ...(allWarnings.length > 0 && { warnings: allWarnings }),
    ...(project !== undefined && { project }),
  };
}

/** Determines each workspace's direct bump from its release history, and finds its untagged baseline. */
function determineDirectBumps(config: MonorepoPrepareConfig, options: ReleasePrepareOptions): Phase1Result {
  const { force, bumpOverride, setVersion } = options;

  // Guard against a programmatic caller that did not narrow `config.workspaces` to one workspace.
  if (setVersion !== undefined && config.workspaces.length !== 1) {
    throw new Error(`--set-version requires exactly one workspace; received ${config.workspaces.length}`);
  }

  const directBumps = new Map<string, ReleaseEntry>();
  const directResults = new Map<string, DirectBumpResult>();
  const skippedResults: SkippedResult[] = [];
  const untaggedBaselines = new Map<string, UntaggedBaseline>();
  const hintState: BaselineHintState = { emitted: false };
  // Build once: the union of every workspace's derived and declared tag prefixes. Passed into
  // the baseline hint so that sibling workspaces' tags aren't misclassified as undeclared
  // candidates.
  const knownPrefixes = config.workspaces.flatMap(getAllTagPrefixes);

  for (const workspace of config.workspaces) {
    const name = workspace.dir;
    const stageLabel = workspaceStageLabel(workspace.dir);

    const tagPrefixes = getAllTagPrefixes(workspace);
    const history = tryStage(stageLabel, () =>
      readReleaseHistory(config, { tagPrefixes, paths: workspace.paths, workspaceDir: workspace.dir }),
    );
    const untagged = tryStage(stageLabel, () =>
      findUntaggedBaseline(
        {
          label: `workspace '${workspace.dir}'`,
          packageFiles: workspace.packageFiles,
          changelogPaths: workspace.changelogPaths,
          tagPrefixes,
          previousTag: history.previousTag,
        },
        config,
      ),
    );
    if (untagged !== undefined) {
      untaggedBaselines.set(workspace.dir, untagged);
    }
    const tag = history.previousTag;
    const since = tag === undefined ? '(no previous release found)' : `since ${tag}`;

    if (tag === undefined) {
      maybeEmitBaselineHint(workspace, knownPrefixes, hintState);
    }

    // --set-version bypass: skip commit-derived bump logic for the overridden workspace.
    if (setVersion !== undefined) {
      // The releaseType in the ReleaseEntry is a sentinel value; `newVersionOverride` takes
      // precedence when propagation computes dependent versions.
      directBumps.set(workspace.dir, { releaseType: 'patch', newVersionOverride: setVersion });
      directResults.set(workspace.dir, {
        workspace,
        history,
        releaseType: undefined,
        bumpOverride: undefined,
        setVersion,
      });
      continue;
    }

    // `--bump=X` is purely a level chooser; `--force` is purely a release trigger that defaults
    // to patch when `--bump` is absent.
    const decision = decideRelease({
      naturalBump: history.unreleased.bump,
      commitCount: history.unreleased.commits.length,
      force,
      bumpOverride,
      skipReasons: {
        noCommits: `No commits for ${name} ${since}. Pass --force to release at patch. Skipping.`,
        noBumpWorthy: `No bump-worthy commits for ${name} ${since}. Pass --force to release at patch (or --force --bump=X for a different level). Skipping.`,
      },
    });

    if (decision.outcome === 'skip') {
      skippedResults.push({ workspace, history, skipReason: decision.skipReason });
      continue;
    }

    directBumps.set(workspace.dir, { releaseType: decision.releaseType });
    directResults.set(workspace.dir, {
      workspace,
      history,
      releaseType: decision.releaseType,
      bumpOverride,
    });
  }

  return { directBumps, directResults, skippedResults, untaggedBaselines };
}

/**
 * Appends to each Phase 1 history's diagnostics the entry scopes that route nowhere in its unreleased window, which
 * only a pass across every workspace's window can find.
 */
function reportUnroutedEntryScopes(
  results: ReadonlyArray<{ workspace: WorkspaceConfig; history: ReleaseHistory }>,
  config: MonorepoPrepareConfig,
  options: ReleasePrepareOptions,
): void {
  const findings = findUnroutedEntryScopes(
    results.map(({ workspace, history }) => ({ dir: workspace.dir, commits: history.unreleased.commits })),
    options.configuredWorkspaceDirs ?? config.workspaces.map((workspace) => workspace.dir),
    config.scopeAliases ?? {},
  );
  for (const { workspace, history } of results) {
    history.unreleased.diagnostics.unroutedEntryScopes = findings.get(workspace.dir) ?? [];
  }
}

/** Collects skipped workspaces, excluding those promoted via propagation. */
function collectSkippedWorkspaces(
  skippedResults: SkippedResult[],
  fullReleaseSet: Map<string, ReleaseEntry>,
): WorkspacePrepareResult[] {
  const workspaces: WorkspacePrepareResult[] = [];
  for (const skipped of skippedResults) {
    if (fullReleaseSet.has(skipped.workspace.dir)) {
      continue;
    }
    const { previousTag, unreleased } = skipped.history;
    const result: SkippedWorkspaceResult = {
      name: skipped.workspace.dir,
      status: 'skipped',
      commitCount: unreleased.commits.length,
      parsedCommitCount: unreleased.parsedCommitCount,
      skipReason: skipped.skipReason,
    };
    if (previousTag !== undefined) {
      result.previousTag = previousTag;
    }
    if (unreleased.unparseableCommits !== undefined) {
      result.unparseableCommits = unreleased.unparseableCommits;
    }
    attachChangelogDiagnostics(result, unreleased.diagnostics);
    workspaces.push(result);
  }
  return workspaces;
}

/** Shared parameters for generating release-notes previews per workspace. */
interface PreviewOptions {
  /** True when `--with-release-notes` is set and `changelogJson.enabled` is true. */
  enabled: boolean;
  /** Section titles in priority order, derived once per run from `resolveWorkTypes(config.workTypes)`. */
  sectionOrder: string[];
}

/** Inputs to {@link executeReleaseSet}. */
interface ExecuteReleaseSetArgs {
  sortedDirs: string[];
  fullReleaseSet: Map<string, ReleaseEntry>;
  config: MonorepoPrepareConfig;
  directResults: Map<string, DirectBumpResult>;
  /** The histories that Phase 1 read for the workspaces that it skipped, keyed by dir. */
  skippedHistories: Map<string, ReleaseHistory>;
  /** Mutated in-place to append every file that the release set intends to write. */
  writes: PlannedWrite[];
  /** Mutated in-place to append warnings raised while planning, such as preview skips. */
  warnings: string[];
  workspaces: WorkspacePrepareResult[];
  previewOptions: PreviewOptions;
  overrideContext: OverrideContext;
  sectionOrder: string[];
}

/** Plans bumps and changelogs for each workspace in dependency order. */
function executeReleaseSet(args: ExecuteReleaseSetArgs): { tags: string[]; modifiedFiles: string[] } {
  const {
    sortedDirs,
    fullReleaseSet,
    config,
    directResults,
    skippedHistories,
    writes,
    warnings,
    workspaces,
    previewOptions,
    overrideContext,
    sectionOrder,
  } = args;
  const tags: string[] = [];
  const modifiedFiles: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const dir of sortedDirs) {
    const releaseEntry = fullReleaseSet.get(dir);
    if (releaseEntry === undefined) {
      continue;
    }

    const workspace = findWorkspace(config.workspaces, dir);
    if (workspace === undefined) {
      continue;
    }

    tryStage(workspaceStageLabel(dir), () =>
      executeWorkspaceRelease({
        dir,
        workspace,
        releaseEntry,
        directResult: directResults.get(dir),
        skippedHistory: skippedHistories.get(dir),
        config,
        today,
        tags,
        modifiedFiles,
        writes,
        warnings,
        workspaces,
        previewOptions,
        overrideContext,
        sectionOrder,
      }),
    );
  }

  return { tags, modifiedFiles };
}

/** Arguments for executing a single workspace's bump + changelog generation. */
interface ExecuteWorkspaceReleaseArgs {
  dir: string;
  workspace: WorkspaceConfig;
  releaseEntry: ReleaseEntry;
  directResult: DirectBumpResult | undefined;
  /** The history that Phase 1 read for a workspace that it skipped; undefined for a direct release. */
  skippedHistory: ReleaseHistory | undefined;
  config: MonorepoPrepareConfig;
  today: string;
  tags: string[];
  modifiedFiles: string[];
  writes: PlannedWrite[];
  warnings: string[];
  workspaces: WorkspacePrepareResult[];
  previewOptions: PreviewOptions;
  overrideContext: OverrideContext;
  sectionOrder: string[];
}

/** Plans the bump and changelogs, and appends the workspace result, for one entry in the release set. */
function executeWorkspaceRelease(args: ExecuteWorkspaceReleaseArgs): void {
  const {
    dir,
    workspace,
    releaseEntry,
    directResult,
    skippedHistory,
    config,
    today,
    tags,
    modifiedFiles,
    writes,
    warnings,
    workspaces,
    previewOptions,
    overrideContext,
    sectionOrder,
  } = args;

  const setVersionTarget = directResult?.setVersion;
  const bump =
    setVersionTarget === undefined
      ? planVersionBump(workspace.packageFiles, releaseEntry.releaseType)
      : planVersionSet(workspace.packageFiles, setVersionTarget);
  const newTag = `${workspace.tagPrefix}${bump.newVersion}`;
  tags.push(newTag);
  writes.push(...bump.writes);
  modifiedFiles.push(
    ...workspace.packageFiles,
    ...workspace.changelogPaths.map((changelogPath) => joinPath(changelogPath, 'CHANGELOG.md')),
  );

  const phase1History = directResult?.history ?? skippedHistory;
  const { changelogFiles, changelogPreservation, previewFiles } = generateWorkspaceChangelogs({
    workspace,
    releaseEntry,
    newTag,
    newVersion: bump.newVersion,
    history: directResult?.history,
    config,
    today,
    modifiedFiles,
    writes,
    warnings,
    previewOptions,
    overrideContext,
    sectionOrder,
  });

  const released: ReleasedWorkspaceResult = {
    name: dir,
    status: 'released',
    commitCount: phase1History?.unreleased.commits.length ?? 0,
    currentVersion: bump.currentVersion,
    newVersion: bump.newVersion,
    tag: newTag,
    bumpedFiles: bump.writes.map((write) => write.path),
    changelogFiles,
    ...(previewFiles.length > 0 && { previewFiles }),
    ...(changelogPreservation.length > 0 && { changelogPreservation }),
  };
  attachReleasedWorkspaceOptionals(released, {
    previousTag: phase1History?.previousTag,
    directResult,
    skippedHistory,
    releaseEntry,
    setVersionTarget,
  });
  workspaces.push(released);
}

/** Inputs to {@link attachReleasedWorkspaceOptionals}. */
interface AttachReleasedOptionalsArgs {
  previousTag: string | undefined;
  directResult: DirectBumpResult | undefined;
  skippedHistory: ReleaseHistory | undefined;
  releaseEntry: ReleaseEntry;
  setVersionTarget: string | undefined;
}

/** Attaches the optional fields of a `ReleasedWorkspaceResult` that apply to this release. */
function attachReleasedWorkspaceOptionals(released: ReleasedWorkspaceResult, args: AttachReleasedOptionalsArgs): void {
  const { previousTag, directResult, skippedHistory, releaseEntry, setVersionTarget } = args;

  if (previousTag !== undefined) {
    released.previousTag = previousTag;
  }
  // For --set-version workspaces, releaseType and the parse counts are left undefined so that
  // reporting can branch on the override case without conflating it with a bump type.
  if (setVersionTarget === undefined) {
    released.releaseType = releaseEntry.releaseType;
  }
  if (directResult !== undefined) {
    attachDirectHistory(released, directResult.history.unreleased, setVersionTarget === undefined);
  } else {
    attachPropagatedHistory(released, skippedHistory?.unreleased);
  }
  if (releaseEntry.propagatedFrom !== undefined) {
    released.propagatedFrom = releaseEntry.propagatedFrom;
  }
  if (directResult?.bumpOverride !== undefined) {
    released.bumpOverride = directResult.bumpOverride;
  }
  if (setVersionTarget !== undefined) {
    released.setVersion = setVersionTarget;
  }
}

/**
 * Attaches a direct release's commits and diagnostics, and, unless `--set-version` chose the version, the counts that
 * the decision read.
 */
function attachDirectHistory(
  released: ReleasedWorkspaceResult,
  unreleased: ReleaseHistory['unreleased'],
  hasDecidedBump: boolean,
): void {
  released.commits = unreleased.commits;
  if (hasDecidedBump) {
    released.parsedCommitCount = unreleased.parsedCommitCount;
    if (unreleased.unparseableCommits !== undefined) {
      released.unparseableCommits = unreleased.unparseableCommits;
    }
  }
  attachChangelogDiagnostics(released, unreleased.diagnostics);
}

/**
 * Marks a release that propagation alone set and attaches the commits and diagnostics of the window that Phase 1
 * read and skipped. `parsedCommitCount` stays absent, since Phase 1 did not decide any bump from it.
 */
function attachPropagatedHistory(
  released: ReleasedWorkspaceResult,
  unreleased: ReleaseHistory['unreleased'] | undefined,
): void {
  released.propagatedOnly = true;
  if (unreleased === undefined) {
    return;
  }
  released.commits = unreleased.commits;
  if (unreleased.unparseableCommits !== undefined) {
    released.unparseableCommits = unreleased.unparseableCommits;
  }
  attachChangelogDiagnostics(released, unreleased.diagnostics);
}

/** Arguments for generating changelog files for a single workspace. */
interface GenerateWorkspaceChangelogsArgs {
  workspace: WorkspaceConfig;
  releaseEntry: ReleaseEntry;
  newTag: string;
  newVersion: string;
  /** The history of a direct release; undefined for a propagation-only one. */
  history: ReleaseHistory | undefined;
  config: MonorepoPrepareConfig;
  today: string;
  modifiedFiles: string[];
  writes: PlannedWrite[];
  warnings: string[];
  previewOptions: PreviewOptions;
  overrideContext: OverrideContext;
  sectionOrder: string[];
}

/**
 * Plans a workspace's changelog files by building the new entries (propagation-only synthetic, or release
 * windows with the synthetic forced-release entry when the unreleased window doesn't yield any item), applying
 * editorial overrides, merging with the JSON on disk, and rendering both `changelog.json` and `CHANGELOG.md` from the
 * merged set so that the two reflect the same post-override view. `CHANGELOG.md` also keeps the existing sections whose
 * versions the merged set lacks.
 */
function generateWorkspaceChangelogs(args: GenerateWorkspaceChangelogsArgs): {
  changelogFiles: string[];
  changelogPreservation: ChangelogPreservation[];
  previewFiles: string[];
} {
  const {
    workspace,
    releaseEntry,
    newTag,
    newVersion,
    history,
    config,
    today,
    modifiedFiles,
    writes,
    warnings,
    previewOptions,
    overrideContext,
    sectionOrder,
  } = args;

  const entries = buildWorkspaceEntries({ workspace, releaseEntry, newTag, newVersion, history, today });

  const applied = applyWorkspaceOverrides(entries, workspace.workspacePath, overrideContext);

  const changelogFiles: string[] = [];
  const changelogPreservation: ChangelogPreservation[] = [];
  let firstMergedEntries: ChangelogEntry[] | undefined;

  for (const changelogPath of workspace.changelogPaths) {
    const jsonPath = resolveChangelogJsonPath(config, changelogPath);
    // Merge with the entries on disk so that the markdown includes prior releases, whether or not the JSON is written.
    const mergedEntries = mergeChangelogEntriesWithDisk(jsonPath, applied.entries);

    if (config.changelogJson.enabled) {
      writes.push({ path: jsonPath, content: renderChangelogJson(mergedEntries) });
      modifiedFiles.push(jsonPath);
      firstMergedEntries ??= mergedEntries;
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

  const previews = planPreviews(workspace, newTag, firstMergedEntries, previewOptions, warnings);
  writes.push(...previews);

  return { changelogFiles, changelogPreservation, previewFiles: previews.map((write) => write.path) };
}

/** Arguments for {@link buildWorkspaceEntries}. */
interface BuildWorkspaceEntriesArgs {
  workspace: WorkspaceConfig;
  releaseEntry: ReleaseEntry;
  newTag: string;
  newVersion: string;
  history: ReleaseHistory | undefined;
  today: string;
}

/**
 * Builds the new `ChangelogEntry[]` for a workspace from one of two sources:
 * 1. Propagation-only: A single synthetic "Dependency updates" entry.
 * 2. Direct release: The workspace's release history, with the synthetic "Forced version bump." entry in place of
 *    the unreleased window when that window doesn't yield any item (`--force` or `--set-version`).
 *
 * Returns the entries that will be merged into the on-disk JSON and rendered.
 */
function buildWorkspaceEntries(args: BuildWorkspaceEntriesArgs): ChangelogEntry[] {
  const { workspace, releaseEntry, newTag, newVersion, history, today } = args;

  if (history === undefined) {
    if (releaseEntry.propagatedFrom === undefined) {
      throw new Error(`Workspace '${workspace.dir}' has neither a direct release nor a propagation source`);
    }
    return [buildSyntheticChangelogEntry(releaseEntry.propagatedFrom, newVersion, today)];
  }

  return toReleaseEntries(history, newTag, today);
}

/**
 * Plans a workspace's release-notes previews when previews are enabled and the workspace produced
 * changelog entries, rendering them from those entries, since the changelog file is not yet written.
 */
function planPreviews(
  workspace: WorkspaceConfig,
  newTag: string,
  entries: ChangelogEntry[] | undefined,
  previewOptions: PreviewOptions,
  warnings: string[],
): PlannedWrite[] {
  if (!previewOptions.enabled || entries === undefined) {
    return [];
  }

  const previews = planReleaseNotesPreviews({
    workspacePath: workspace.workspacePath,
    tag: newTag,
    entries,
    sectionOrder: previewOptions.sectionOrder,
  });
  warnings.push(...previews.warnings);

  return previews.writes;
}

/**
 * Renders the format command over the modified files, if configured and the plan contains a release.
 *
 * The command is not run here: It reformats the very files that the plan has yet to write, so the
 * caller runs it once the plan is on disk.
 */
function planFormatCommand(
  config: MonorepoPrepareConfig,
  tags: string[],
  modifiedFiles: string[],
): ReleasePlan['formatCommand'] {
  const formatCommandStr = config.formatCommand ?? (hasPrettierConfig() ? 'npx prettier --write' : undefined);

  if (tags.length === 0 || formatCommandStr === undefined) {
    return undefined;
  }

  return { command: `${formatCommandStr} ${modifiedFiles.join(' ')}`, files: modifiedFiles };
}

/** Finds a workspace by its `dir` in the workspaces array. */
function findWorkspace(workspaces: readonly WorkspaceConfig[], dir: string): WorkspaceConfig | undefined {
  return workspaces.find((w) => w.dir === dir);
}

/**
 * Runs `fn` and rethrows any thrown value behind a stage label. The composed message starts with
 * `<stageLabel>:`.
 */
function tryStage<T>(stageLabel: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw chainError(stageLabel, error);
  }
}

/** Builds the per-workspace stage label used for both Phase 1 and Phase 3 attribution. */
function workspaceStageLabel(dir: string): string {
  return `workspace '${dir}' release stage`;
}

/** Shared single-fire flag so that multiple no-baseline workspaces trigger at most one hint per run. */
interface BaselineHintState {
  emitted: boolean;
}

/**
 * Emits a one-line hint to stderr pointing at `release-kit show-tag-prefixes` when a workspace
 * doesn't have a baseline tag AND the repo contains candidate-shaped tags AND the workspace
 * doesn't declare any `legacyIdentities`.
 *
 * `knownPrefixes` must be the full union across all workspaces so that sibling workspaces' tags
 * are not mistaken for undeclared candidates.
 *
 * Prints at most once per prepare run. Does not affect exit code or bump behavior.
 */
function maybeEmitBaselineHint(
  workspace: WorkspaceConfig,
  knownPrefixes: readonly string[],
  state: BaselineHintState,
): void {
  if (state.emitted) return;
  if ((workspace.legacyIdentities?.length ?? 0) > 0) return;

  const candidates = detectUndeclaredTagPrefixes(knownPrefixes);
  if (candidates.length === 0) return;

  const totalTags = candidates.reduce((sum, candidate) => sum + candidate.tagCount, 0);
  const example = candidates[0]?.exampleTags[0] ?? `${candidates[0]?.prefix ?? ''}?`;
  process.stderr.write(
    `Hint: no baseline tag found for ${workspace.dir} under '${workspace.tagPrefix}', but ` +
      `${totalTags} candidate-shaped tags exist (e.g., ${example}). ` +
      "Run 'release-kit show-tag-prefixes' to check for undeclared legacy prefixes.\n",
  );
  state.emitted = true;
}

/**
 * Sorts workspace dirs topologically so that dependencies are processed before their dependents.
 *
 * Uses Kahn's algorithm. Workspaces not in the release set are excluded. If the graph has
 * cycles, the remaining nodes are appended in arbitrary order and reported via `cyclicDirs`.
 */
function topologicalSort(
  releaseSet: Map<string, ReleaseEntry>,
  graph: DependencyGraph,
): { sorted: string[]; cyclicDirs: string[] } {
  const releaseDirs = new Set(releaseSet.keys());
  if (releaseDirs.size === 0) {
    return { sorted: [], cyclicDirs: [] };
  }

  // Build a forward adjacency list (dependency -> dependent) restricted to the release set.
  const inDegree = new Map<string, number>();
  const forwardEdges = new Map<string, string[]>();

  for (const dir of releaseDirs) {
    inDegree.set(dir, 0);
    forwardEdges.set(dir, []);
  }

  // Add an edge for each dependency-dependent pair inside the release set.
  for (const [packageName, dependents] of graph.dependentsOf) {
    const depDir = graph.packageNameToDir.get(packageName);
    if (depDir === undefined || !releaseDirs.has(depDir)) {
      continue;
    }

    for (const dependent of dependents) {
      if (!releaseDirs.has(dependent.dir)) {
        continue;
      }

      const edges = forwardEdges.get(depDir);
      if (edges !== undefined) {
        edges.push(dependent.dir);
      }

      inDegree.set(dependent.dir, (inDegree.get(dependent.dir) ?? 0) + 1);
    }
  }

  // Kahn's algorithm.
  const queue: string[] = [];
  for (const [dir, degree] of inDegree) {
    if (degree === 0) {
      queue.push(dir);
    }
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const dir = queue.shift();
    if (dir === undefined) {
      break;
    }
    sorted.push(dir);

    const dependents = forwardEdges.get(dir) ?? [];
    for (const dependent of dependents) {
      const newDegree = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) {
        queue.push(dependent);
      }
    }
  }

  // Append any remaining (cyclic) nodes.
  const sortedSet = new Set(sorted);
  const cyclicDirs: string[] = [];
  for (const dir of releaseDirs) {
    if (sortedSet.has(dir)) {
      continue;
    }

    sorted.push(dir);
    cyclicDirs.push(dir);
  }

  return { sorted, cyclicDirs };
}
