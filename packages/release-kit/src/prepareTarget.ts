import { join as joinPath } from 'node:path';

import { findUntaggedBaseline, type UntaggedBaseline } from './assertTaggedBaseline.ts';
import { attachChangelogDiagnostics } from './attachChangelogDiagnostics.ts';
import { readReleaseHistory, type ReleaseHistory, toReleaseEntries } from './buildChangelogEntries.ts';
import { buildSyntheticChangelogEntry } from './buildSyntheticChangelogEntry.ts';
import { mergeChangelogEntriesWithDisk, renderChangelogJson, resolveChangelogJsonPath } from './changelogJsonFile.ts';
import { applyWorkspaceOverrides, type OverrideContext } from './changelogOverrides.ts';
import { decideRelease } from './decideRelease.ts';
import { type GenerateChangelogOptions, getAllTagPrefixes } from './generateChangelogs.ts';
import { planReleaseNotesPreviews } from './planReleaseNotesPreviews.ts';
import { planVersionBump, planVersionSet } from './planVersionBump.ts';
import { planPreservedSections } from './readChangelogSections.ts';
import type { PlannedWrite } from './releasePlan.ts';
import { renderChangelogMarkdown } from './renderChangelogMarkdown.ts';
import type {
  ChangelogEntry,
  ChangelogPreservation,
  PropagationSource,
  ReleasedCompositeResult,
  ReleasedPackageResult,
  ReleasedTargetResult,
  ReleaseSettings,
  ReleaseTarget,
  ReleaseType,
  SkippedCompositeResult,
  SkippedPackageResult,
  TargetPrepareResult,
} from './types.ts';

/** The shared settings that the prepare step reads, which do not include the release-notes settings. */
export type TargetPrepareSettings = Omit<ReleaseSettings, 'releaseNotes'>;

/** One read of a target's release windows, and the untagged baseline that it found, if any. */
export interface TargetReading {
  history: ReleaseHistory;
  untagged: UntaggedBaseline | undefined;
}

/** Outcome of {@link decideTargetRelease}: a release at a decided level or at an explicit version, or a skip. */
export type TargetDecision =
  | { outcome: 'release'; releaseType: ReleaseType; bumpOverride: ReleaseType | undefined; setVersion: undefined }
  | { outcome: 'release'; releaseType: undefined; bumpOverride: undefined; setVersion: string }
  | { outcome: 'skip'; skipReason: string };

/** The release level that a target takes, whether its own commits or a dependency's bump decided it. */
export interface TargetRelease {
  releaseType: ReleaseType;
  /** Dependencies whose bumps this release records; present for a propagated or mixed release. */
  propagatedFrom?: PropagationSource[];
}

/** Inputs to {@link planTargetRelease}. */
export interface PlanTargetReleaseArgs {
  target: ReleaseTarget;
  settings: TargetPrepareSettings;
  /** The level of the release and, for a propagated release, the dependencies that set it. */
  release: TargetRelease;
  /**
   * The decision behind a direct release; undefined for a release that propagation alone set, whose own window called
   * for none.
   */
  decision: Extract<TargetDecision, { outcome: 'release' }> | undefined;
  /** The window that the target's read produced. */
  history: ReleaseHistory;
  overrideContext: OverrideContext;
  /** Section titles in priority order. */
  sectionOrder: string[];
  /** Header of the section under which a propagation-only entry lists its dependencies. */
  dependenciesHeader: string;
  /** True when release-notes previews are requested and `changelogJson.enabled` is true. */
  shouldPlanPreviews: boolean;
  /** The release date, as `YYYY-MM-DD`. */
  today: string;
}

/** A target's planned release: its result and the tag, writes, and modified files that the run collects. */
export interface PlannedTargetRelease {
  result: ReleasedTargetResult;
  tag: string;
  writes: PlannedWrite[];
  /** Files that the format command covers: the version files, the `CHANGELOG.md`, and any changelog JSON. */
  modifiedFiles: string[];
  /** Warnings raised while planning the release-notes previews. */
  warnings: string[];
}

/** Reads a target's release windows under its tag prefixes and commit window, and finds its untagged baseline. */
export function readTargetHistory(target: ReleaseTarget, settings: TargetPrepareSettings): TargetReading {
  const options = describeHistoryWindow(target);
  const history = readReleaseHistory(settings, options);
  const untagged = findUntaggedBaseline(
    {
      label: describeBaselineLabel(target),
      packageFiles: target.versionFiles,
      changelogPaths: [target.changelogDir],
      tagPrefixes: options.tagPrefixes,
      previousTag: history.previousTag,
    },
    settings,
  );
  return { history, untagged };
}

/**
 * Returns the bounds of a target's history read: its current and legacy tag prefixes, its commit window, and, for a
 * workspace, the `dir` to which change-record entries route.
 */
export function describeHistoryWindow(target: ReleaseTarget): GenerateChangelogOptions {
  return {
    tagPrefixes: getAllTagPrefixes(target),
    ...(target.paths !== undefined && { paths: target.paths }),
    ...(target.kind === 'package' && target.workspaceDir !== undefined && { workspaceDir: target.workspaceDir }),
  };
}

/**
 * Decides a target's direct release from its window: `setVersion` releases at that version, and otherwise the
 * window's bump, `force`, and `bumpOverride` decide as {@link decideRelease} states.
 */
export function decideTargetRelease(
  target: ReleaseTarget,
  history: ReleaseHistory,
  options: { force: boolean; bumpOverride: ReleaseType | undefined; setVersion: string | undefined },
): TargetDecision {
  const { force, bumpOverride, setVersion } = options;
  if (setVersion !== undefined) {
    return { outcome: 'release', releaseType: undefined, bumpOverride: undefined, setVersion };
  }

  const tag = history.previousTag;
  const since = tag === undefined ? '(no previous release found)' : `since ${tag}`;
  const subject = target.kind === 'package' && target.workspaceDir !== undefined ? ` for ${target.id}` : '';
  const decision = decideRelease({
    naturalBump: history.unreleased.bump,
    commitCount: history.unreleased.commits.length,
    force,
    bumpOverride,
    skipReasons: {
      noCommits: `No commits${subject} ${since}. Pass --force to release at patch. Skipping.`,
      noBumpWorthy: `No bump-worthy commits${subject} ${since}. Pass --force to release at patch (or --force --bump=X for a different level). Skipping.`,
    },
  });

  if (decision.outcome === 'skip') {
    return decision;
  }
  return { outcome: 'release', releaseType: decision.releaseType, bumpOverride, setVersion: undefined };
}

/**
 * Plans a target's release: the version bump, the changelogs, and the release-notes previews, and builds its result.
 *
 * The changelog entries come from the target's release windows, with the synthetic "Forced version bump." entry for a
 * window that doesn't yield any item, or, for a release that propagation alone set, from one synthetic entry listing
 * the dependencies. Overrides apply before `changelog.json` and `CHANGELOG.md` render from the merged set, and
 * `CHANGELOG.md` keeps the existing sections whose versions the merged set lacks.
 */
export function planTargetRelease(args: PlanTargetReleaseArgs): PlannedTargetRelease {
  const { target, settings, release, decision, history, overrideContext, sectionOrder, shouldPlanPreviews, today } =
    args;
  const setVersion = decision?.setVersion;

  const bump =
    setVersion === undefined
      ? planVersionBump(target.versionFiles, release.releaseType)
      : planVersionSet(target.versionFiles, setVersion);
  const tag = `${target.tagPrefix}${bump.newVersion}`;
  const writes: PlannedWrite[] = [...bump.writes];

  const entries =
    decision === undefined
      ? buildPropagationEntries(target, release, bump.newVersion, today, args.dependenciesHeader)
      : toReleaseEntries(history, tag, today);
  const overrideScope = target.kind === 'package' ? target.packagePath : undefined;
  const applied = applyWorkspaceOverrides(entries, overrideScope, overrideContext);

  const changelogs = planChangelogFiles(target.changelogDir, applied.entries, settings, sectionOrder);
  writes.push(...changelogs.writes);

  const warnings: string[] = [];
  const previewFiles: string[] = [];
  if (shouldPlanPreviews) {
    const previews = planReleaseNotesPreviews({
      workspacePath: target.changelogDir,
      tag,
      entries: changelogs.entries,
      sectionOrder,
    });
    writes.push(...previews.writes);
    warnings.push(...previews.warnings);
    previewFiles.push(...previews.writes.map((write) => write.path));
  }

  const releaseFields = {
    targetId: target.id,
    commitCount: history.unreleased.commits.length,
    currentVersion: bump.currentVersion,
    newVersion: bump.newVersion,
    tag,
    bumpedFiles: bump.writes.map((write) => write.path),
    changelogFiles: [changelogs.changelogFile],
    ...(previewFiles.length > 0 && { previewFiles }),
    ...(changelogs.preservation !== undefined && { changelogPreservation: [changelogs.preservation] }),
    ...(history.previousTag !== undefined && { previousTag: history.previousTag }),
  };
  const result =
    target.kind === 'composite'
      ? buildReleasedComposite(releaseFields, release, decision, history)
      : buildReleasedPackage(target, releaseFields, release, decision, history);

  return {
    result,
    tag,
    writes,
    modifiedFiles: [...target.versionFiles, changelogs.changelogFile, ...changelogs.changelogJsonFiles],
    warnings,
  };
}

/** Builds the result of a target that skips, from the window that its read produced. */
export function buildSkippedTargetResult(
  target: ReleaseTarget,
  history: ReleaseHistory,
  skipReason: string,
): TargetPrepareResult {
  const { unreleased } = history;
  const fields = {
    targetId: target.id,
    status: 'skipped' as const,
    commitCount: unreleased.commits.length,
    parsedCommitCount: unreleased.parsedCommitCount,
    skipReason,
    ...(history.previousTag !== undefined && { previousTag: history.previousTag }),
    ...(unreleased.unparseableCommits !== undefined && { unparseableCommits: unreleased.unparseableCommits }),
  };
  const skipped: SkippedCompositeResult | SkippedPackageResult =
    target.kind === 'composite'
      ? { ...fields, kind: 'composite' }
      : { ...fields, kind: 'package', ...(target.workspaceDir !== undefined && { name: target.workspaceDir }) };
  attachChangelogDiagnostics(skipped, unreleased.diagnostics);
  return skipped;
}

// region | Helpers

/** The fields that a released result of either kind takes from the plan. */
type ReleaseResultFields = Omit<
  ReleasedCompositeResult,
  'commits' | 'kind' | 'parsedCommitCount' | 'releaseType' | 'status'
>;

/** Builds the released result of a composite target, which a direct decision always releases at a level. */
function buildReleasedComposite(
  fields: ReleaseResultFields,
  release: TargetRelease,
  decision: Extract<TargetDecision, { outcome: 'release' }> | undefined,
  history: ReleaseHistory,
): ReleasedCompositeResult {
  const { unreleased } = history;
  const result: ReleasedCompositeResult = {
    ...fields,
    status: 'released',
    kind: 'composite',
    parsedCommitCount: unreleased.parsedCommitCount,
    releaseType: release.releaseType,
    commits: unreleased.commits,
    ...(unreleased.unparseableCommits !== undefined && { unparseableCommits: unreleased.unparseableCommits }),
    ...(decision?.bumpOverride !== undefined && { bumpOverride: decision.bumpOverride }),
  };
  attachChangelogDiagnostics(result, unreleased.diagnostics);
  return result;
}

/**
 * Builds the released result of a package target. `--set-version` leaves `releaseType` and the parse counts off, so
 * that reporting can tell the override from a bump, and a release that propagation alone set is marked
 * `propagatedOnly` without a parse count, since no bump was decided from its window.
 */
function buildReleasedPackage(
  target: Extract<ReleaseTarget, { kind: 'package' }>,
  fields: ReleaseResultFields,
  release: TargetRelease,
  decision: Extract<TargetDecision, { outcome: 'release' }> | undefined,
  history: ReleaseHistory,
): ReleasedPackageResult {
  const { unreleased } = history;
  const setVersion = decision?.setVersion;
  const hasParseCounts = decision !== undefined && setVersion === undefined;
  const result: ReleasedPackageResult = {
    ...fields,
    status: 'released',
    kind: 'package',
    commits: unreleased.commits,
    ...(target.workspaceDir !== undefined && { name: target.workspaceDir }),
    ...(setVersion === undefined && { releaseType: release.releaseType }),
    ...(hasParseCounts && { parsedCommitCount: unreleased.parsedCommitCount }),
    ...(decision === undefined && { propagatedOnly: true as const }),
    ...(release.propagatedFrom !== undefined && { propagatedFrom: release.propagatedFrom }),
    ...(decision?.bumpOverride !== undefined && { bumpOverride: decision.bumpOverride }),
    ...(setVersion !== undefined && { setVersion }),
  };
  if (setVersion === undefined && unreleased.unparseableCommits !== undefined) {
    result.unparseableCommits = unreleased.unparseableCommits;
  }
  attachChangelogDiagnostics(result, unreleased.diagnostics);
  return result;
}

/** Builds the one synthetic entry of a release that propagation alone set, under the dependencies header. */
function buildPropagationEntries(
  target: ReleaseTarget,
  release: TargetRelease,
  newVersion: string,
  today: string,
  dependenciesHeader: string,
): ChangelogEntry[] {
  if (release.propagatedFrom === undefined) {
    throw new Error(`Workspace '${target.id}' has neither a direct release nor a propagation source`);
  }
  return [buildSyntheticChangelogEntry(release.propagatedFrom, newVersion, today, dependenciesHeader)];
}

/** Names a target in the untagged-baseline error. */
function describeBaselineLabel(target: ReleaseTarget): string {
  if (target.kind === 'composite') {
    return 'project';
  }
  return target.workspaceDir === undefined ? 'package' : `workspace '${target.id}'`;
}

/**
 * Plans the `changelog.json` (when enabled) and `CHANGELOG.md` of one changelog directory from the new entries merged
 * with the entries on disk, so that the markdown includes prior releases whether or not the JSON is written.
 */
function planChangelogFiles(
  changelogDir: string,
  newEntries: ChangelogEntry[],
  settings: TargetPrepareSettings,
  sectionOrder: string[],
): {
  changelogFile: string;
  changelogJsonFiles: string[];
  entries: ChangelogEntry[];
  preservation: ChangelogPreservation | undefined;
  writes: PlannedWrite[];
} {
  const jsonPath = resolveChangelogJsonPath(settings, changelogDir);
  const entries = mergeChangelogEntriesWithDisk(jsonPath, newEntries);
  const writes: PlannedWrite[] = [];
  const changelogJsonFiles: string[] = [];

  if (settings.changelogJson.enabled) {
    writes.push({ path: jsonPath, content: renderChangelogJson(entries) });
    changelogJsonFiles.push(jsonPath);
  }

  const changelogFile = joinPath(changelogDir, 'CHANGELOG.md');
  const preserved = planPreservedSections(changelogFile, entries);
  writes.push({
    path: changelogFile,
    content: renderChangelogMarkdown(entries, { sectionOrder, preservedSections: preserved.sections }),
  });

  return { changelogFile, changelogJsonFiles, entries, preservation: preserved.preservation, writes };
}

// endregion | Helpers
