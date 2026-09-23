import { join as joinPath } from 'node:path';

import { chainError } from '@williamthorsen/toolbelt.errors/candidate';

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
import { detectUndeclaredTagPrefixes } from './detectUndeclaredTagPrefixes.ts';
import { getAllTagPrefixes } from './generateChangelogs.ts';
import { hasPrettierConfig } from './hasPrettierConfig.ts';
import { resolveWorkTypes } from './loadConfig.ts';
import { planReleaseNotesPreviews } from './planReleaseNotesPreviews.ts';
import { planVersionBump, planVersionSet } from './planVersionBump.ts';
import { propagateBumps, type ReleaseEntry } from './propagateBumps.ts';
import type { PlannedWrite, ReleasePlan } from './releasePlan.ts';
import type { ReleasePrepareOptions } from './releasePrepare.ts';
import { releasePrepareProject } from './releasePrepareProject.ts';
import { renderChangelogMarkdown } from './renderChangelogMarkdown.ts';
import { deriveSectionOrder } from './resolveReleaseNotesConfig.ts';
import type {
  ChangelogEntry,
  MonorepoReleaseConfig,
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
  /** Set when `--bump=X` was supplied for this workspace's direct release; surfaced to renderer. */
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
}

/**
 * Orchestrate release preparation for a monorepo with multiple workspaces.
 *
 * Phase 1: Determine direct bumps from commits for each workspace.
 * Phase 2: Build the dependency graph and propagate bumps to dependents.
 * Phase 2b: Topologically sort the full release set.
 * Phase 3: Execute bumps and generate changelogs in dependency order.
 */
export function releasePrepareMono(config: MonorepoReleaseConfig, options: ReleasePrepareOptions): ReleasePlan {
  const { only, withReleaseNotes } = options;
  const writes: PlannedWrite[] = [];
  const warnings: string[] = [];

  if (withReleaseNotes === true && !config.changelogJson.enabled) {
    warnings.push('--with-release-notes requires changelogJson.enabled; skipping preview generation');
  }

  // Derive section order once for all preview and markdown render writes.
  const sectionOrder = deriveSectionOrder(resolveWorkTypes(config.workTypes));

  // Load editorial overrides once per prepare run (root file plus every workspace file).
  // Failure on any file aborts the release with a clear error before any writes.
  //
  // `globalMatchedRootKeys` tracks every ROOT key that matched somewhere — in a workspace or
  // in the project changelog. After all apply calls complete, root keys NOT in this set are
  // genuinely stale and warned exactly once. Per-workspace stale warnings emit immediately
  // against each workspace's own apply context (handled inside the workspace apply site).
  const overrideContext = createOverrideContext(config.workspaces);

  // === Phase 1: Determine direct bumps ===
  const { directBumps, directResults, skippedResults } = determineDirectBumps(config, options);

  // Build a lookup of previous tags for all workspaces (needed for propagated ones).
  const previousTags = new Map<string, string | undefined>();
  for (const result of directResults.values()) {
    previousTags.set(result.workspace.dir, result.history.previousTag);
  }
  for (const skipped of skippedResults) {
    previousTags.set(skipped.workspace.dir, skipped.history.previousTag);
  }

  // === Phase 2: Build graph and propagate bumps ===
  const graph = buildDependencyGraph(config.workspaces);
  const fullReleaseSet = propagateBumps(directBumps, graph);

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
    previousTags,
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
  // Runs after the per-workspace loop (so contributing workspaces are settled) but before
  // `runFormatCommand` (so root files participate in formatting). A narrowed run skips the
  // stage: the project release rolls up every contributing workspace, and `--only` has changed
  // which workspaces those are, so a roll-up would cover a set the caller did not ask for.
  //
  // `releasePrepareProject` returns a structured `ProjectPrepareResult` for both released
  // and skipped variants — `undefined` here means "no project block configured, or narrowed away."
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

  // Emit one stale-key warning per ROOT key that didn't match anywhere — in any workspace
  // apply call (where it wasn't shadowed) or in the project apply call. Keys matched in at
  // least one batch are correctly applied; warning about them would be misleading. Per-workspace
  // stale warnings have already been pushed onto `overrideWarnings` immediately at each
  // workspace's apply site, so this loop only scans the root-tier keys.
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

/** Determine each workspace's direct bump from its release history. */
function determineDirectBumps(config: MonorepoReleaseConfig, options: ReleasePrepareOptions): Phase1Result {
  const { force, bumpOverride, setVersion } = options;

  // Enforce the `--set-version` contract at the orchestration layer. The CLI layer
  // (`prepareCommand`) normally narrows to a single workspace before calling, but this
  // guard protects against programmatic misuse.
  if (setVersion !== undefined && config.workspaces.length !== 1) {
    throw new Error(`--set-version requires exactly one workspace; received ${config.workspaces.length}`);
  }

  const directBumps = new Map<string, ReleaseEntry>();
  const directResults = new Map<string, DirectBumpResult>();
  const skippedResults: SkippedResult[] = [];
  const hintState: BaselineHintState = { emitted: false };
  // Build once: the union of every workspace's derived and declared tag prefixes. Passed into
  // the baseline hint so sibling workspaces' tags aren't misclassified as undeclared candidates.
  const knownPrefixes = config.workspaces.flatMap(getAllTagPrefixes);

  for (const workspace of config.workspaces) {
    const name = workspace.dir;
    const stageLabel = workspaceStageLabel(workspace.dir);

    const history = tryStage(stageLabel, () =>
      readReleaseHistory(config, { tagPrefixes: getAllTagPrefixes(workspace), paths: workspace.paths }),
    );
    const tag = history.previousTag;
    const since = tag === undefined ? '(no previous release found)' : `since ${tag}`;

    if (tag === undefined) {
      maybeEmitBaselineHint(workspace, knownPrefixes, hintState);
    }

    // --set-version bypass: skip commit-derived bump logic for the overridden workspace.
    // Validation that only one workspace is targeted runs in `prepareCommand` before this function.
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
    // to patch when no level is given.
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

  return { directBumps, directResults, skippedResults };
}

/** Collect skipped workspaces, excluding those promoted via propagation. */
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
  config: MonorepoReleaseConfig;
  directResults: Map<string, DirectBumpResult>;
  previousTags: Map<string, string | undefined>;
  /** Mutated in-place to append every file the release set intends to write. */
  writes: PlannedWrite[];
  /** Mutated in-place to append warnings raised while planning, such as preview skips. */
  warnings: string[];
  workspaces: WorkspacePrepareResult[];
  previewOptions: PreviewOptions;
  overrideContext: OverrideContext;
  sectionOrder: string[];
}

/** Plan bumps and changelogs for each workspace in dependency order. */
function executeReleaseSet(args: ExecuteReleaseSetArgs): { tags: string[]; modifiedFiles: string[] } {
  const {
    sortedDirs,
    fullReleaseSet,
    config,
    directResults,
    previousTags,
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
        previousTags,
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
  previousTags: Map<string, string | undefined>;
  config: MonorepoReleaseConfig;
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

/** Plan the bump and changelogs, and append the workspace result, for one entry in the release set. */
function executeWorkspaceRelease(args: ExecuteWorkspaceReleaseArgs): void {
  const {
    dir,
    workspace,
    releaseEntry,
    directResult,
    previousTags,
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

  // Plan the version change for this workspace. For --set-version workspaces, use the explicit
  // version; otherwise derive the bump from the release type.
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

  const directCommits = directResult?.history.unreleased.commits;
  const { changelogFiles, previewFiles } = generateWorkspaceChangelogs({
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
    commitCount: directCommits?.length ?? 0,
    currentVersion: bump.currentVersion,
    newVersion: bump.newVersion,
    tag: newTag,
    bumpedFiles: bump.writes.map((write) => write.path),
    changelogFiles,
    ...(previewFiles.length > 0 && { previewFiles }),
  };
  attachReleasedWorkspaceOptionals(released, {
    previousTag: directResult?.history.previousTag ?? previousTags.get(dir),
    directResult,
    releaseEntry,
    setVersionTarget,
  });
  workspaces.push(released);
}

/** Inputs to {@link attachReleasedWorkspaceOptionals}. */
interface AttachReleasedOptionalsArgs {
  previousTag: string | undefined;
  directResult: DirectBumpResult | undefined;
  releaseEntry: ReleaseEntry;
  setVersionTarget: string | undefined;
}

/**
 * Attach the optional fields of a `ReleasedWorkspaceResult` (previousTag, the unreleased window's
 * commits and diagnostics, releaseType, propagatedFrom, bumpOverride, setVersion) using the
 * conditional-assignment rules from the surrounding executor.
 *
 * Extracted from `executeWorkspaceRelease` so each conditional branch lives outside the host
 * function's cyclomatic-complexity budget.
 */
function attachReleasedWorkspaceOptionals(released: ReleasedWorkspaceResult, args: AttachReleasedOptionalsArgs): void {
  const { previousTag, directResult, releaseEntry, setVersionTarget } = args;

  if (previousTag !== undefined) {
    released.previousTag = previousTag;
  }
  // For --set-version workspaces releaseType and the parse counts are left undefined so
  // reporting can branch on the override case without conflating it with a bump type.
  if (setVersionTarget === undefined) {
    released.releaseType = releaseEntry.releaseType;
  }
  if (directResult !== undefined) {
    attachDirectHistory(released, directResult.history.unreleased, setVersionTarget === undefined);
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

/** Arguments for generating changelog files for a single workspace. */
interface GenerateWorkspaceChangelogsArgs {
  workspace: WorkspaceConfig;
  releaseEntry: ReleaseEntry;
  newTag: string;
  newVersion: string;
  /** The history of a direct release; undefined for a propagation-only one. */
  history: ReleaseHistory | undefined;
  config: MonorepoReleaseConfig;
  today: string;
  modifiedFiles: string[];
  writes: PlannedWrite[];
  warnings: string[];
  previewOptions: PreviewOptions;
  overrideContext: OverrideContext;
  sectionOrder: string[];
}

/**
 * Plan a workspace's changelog artifacts by building the new entries (propagation-only synthetic, or release
 * windows with the synthetic forced-release entry when the unreleased window yields no item), applying editorial
 * overrides, merging with the JSON on disk, and rendering both `changelog.json` and
 * `CHANGELOG.md` from the merged set so the two reflect the same post-override view.
 */
function generateWorkspaceChangelogs(args: GenerateWorkspaceChangelogsArgs): {
  changelogFiles: string[];
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
  let firstMergedEntries: ChangelogEntry[] | undefined;

  for (const changelogPath of workspace.changelogPaths) {
    const jsonPath = resolveChangelogJsonPath(config, changelogPath);
    // Merge with what is on disk so the markdown renderer sees prior entries. Only plan the JSON
    // write when `changelogJson.enabled`; the merge runs either way, so the markdown reflects
    // the same set whether or not the JSON artifact is produced.
    const mergedEntries = mergeChangelogEntriesWithDisk(jsonPath, applied.entries);

    if (config.changelogJson.enabled) {
      writes.push({ path: jsonPath, content: renderChangelogJson(mergedEntries) });
      modifiedFiles.push(jsonPath);
      firstMergedEntries ??= mergedEntries;
    }

    const changelogFile = joinPath(changelogPath, 'CHANGELOG.md');
    writes.push({ path: changelogFile, content: renderChangelogMarkdown(mergedEntries, { sectionOrder }) });
    changelogFiles.push(changelogFile);
  }

  const previews = planPreviews(workspace, newTag, firstMergedEntries, previewOptions, warnings);
  writes.push(...previews);

  return { changelogFiles, previewFiles: previews.map((write) => write.path) };
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
 * Build the new `ChangelogEntry[]` for a workspace from one of two sources:
 * 1. Propagation-only: a single synthetic "Dependency updates" entry.
 * 2. Direct release: the workspace's release history, with the synthetic "Forced version bump." entry in place of
 *    the unreleased window when that window yields no item (`--force` or `--set-version`).
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
 * Plan a workspace's release-notes previews when previews are enabled and the workspace produced
 * changelog entries, rendering them from those entries rather than from the file not yet written.
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
 * Render the format command over the modified files, if configured.
 *
 * The command is not run here: it reformats the very files the plan has yet to write, so the
 * caller runs it once the plan is on disk.
 */
function planFormatCommand(
  config: MonorepoReleaseConfig,
  tags: string[],
  modifiedFiles: string[],
): ReleasePlan['formatCommand'] {
  const formatCommandStr = config.formatCommand ?? (hasPrettierConfig() ? 'npx prettier --write' : undefined);

  if (tags.length === 0 || formatCommandStr === undefined) {
    return undefined;
  }

  return { command: `${formatCommandStr} ${modifiedFiles.join(' ')}`, files: modifiedFiles };
}

/** Find a workspace by its `dir` in the workspaces array. */
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

/** Build the per-workspace stage label used for both Phase 1 and Phase 3 attribution. */
function workspaceStageLabel(dir: string): string {
  return `workspace '${dir}' release stage`;
}

/** Shared single-fire flag so multiple no-baseline workspaces trigger at most one hint per run. */
interface BaselineHintState {
  emitted: boolean;
}

/**
 * Emit a one-line hint to stderr pointing at `release-kit show-tag-prefixes` when a workspace
 * has no baseline tag AND the repo contains candidate-shaped tags AND the workspace has no
 * declared `legacyIdentities`.
 *
 * `knownPrefixes` must be the full union across all workspaces so sibling workspaces' tags
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
 * Topologically sort workspace dirs so dependencies are processed before their dependents.
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

  // For each released workspace, find its dependencies that are also in the release set.
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
