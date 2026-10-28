import { findUntaggedBaseline, type UntaggedBaseline } from './assertTaggedBaseline.ts';
import { attachChangelogDiagnostics } from './attachChangelogDiagnostics.ts';
import { readReleaseHistory, type ReleaseHistory, convertToReleaseEntries } from './buildChangelogEntries.ts';
import { buildPropagationEntries, buildReleasedResult, type TargetRelease } from './buildReleasedResult.ts';
import { applyWorkspaceOverrides, type OverrideContext } from './changelogOverrides.ts';
import { decideRelease } from './decideRelease.ts';
import { type GenerateChangelogOptions, getAllTagPrefixes } from './generateChangelogs.ts';
import { planChangelogFiles } from './planChangelogFiles.ts';
import { planReleaseNotesPreviews } from './planReleaseNotesPreviews.ts';
import { planVersionBump, planVersionSet } from './planVersionBump.ts';
import type { PlannedWrite } from './releasePlan.ts';
import { PROJECT_TARGET_ID } from './resolveReleaseTargets.ts';
import type {
  DirectoryTarget,
  ReleasedTargetResult,
  ReleaseSettings,
  ReleaseTarget,
  ReleaseType,
  SkippedCompositeResult,
  SkippedDirectoryResult,
  SkippedPackageResult,
  TargetPrepareResult,
} from './types.ts';

/** The shared settings that the prepare step reads, which do not include the release-notes settings. */
export type TargetPrepareSettings = Omit<ReleaseSettings, 'releaseNotes'>;

/** One read of a target's release windows, and the untagged baseline that it found, if any. */
export interface TargetReading {
  history: ReleaseHistory;
  untaggedBaseline: UntaggedBaseline | undefined;
}

/** Outcome of {@link decideTargetRelease}: a release at a decided level or at an explicit version, or a skip. */
export type TargetDecision =
  | { outcome: 'release'; releaseType: ReleaseType; bumpOverride: ReleaseType | undefined; setVersion: undefined }
  | { outcome: 'release'; releaseType: undefined; bumpOverride: undefined; setVersion: string }
  | { outcome: 'skip'; skipReason: string };

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
  /** Archive files of the target's `CHANGELOG.md` that the release removes. */
  removals: string[];
  /**
   * Files that the format command covers: the version files, the `CHANGELOG.md` and its archive files, and any
   * changelog JSON.
   */
  modifiedFiles: string[];
  /** Warnings raised while planning the release-notes previews. */
  warnings: string[];
}

/** Reads a target's release windows under its tag prefixes and commit window, and finds its untagged baseline. */
export function readTargetHistory(target: ReleaseTarget, settings: TargetPrepareSettings): TargetReading {
  const options = describeHistoryWindow(target);
  const history = readReleaseHistory(settings, options);
  const untaggedBaseline = findUntaggedBaseline(
    {
      label: describeBaselineLabel(target),
      packageFiles: target.versionFiles,
      changelogPaths: [target.changelogDir],
      tagPrefixes: options.tagPrefixes,
      previousTag: history.previousTag,
    },
    settings,
  );
  return { history, untaggedBaseline };
}

/**
 * Returns the bounds of a target's history read: its current and legacy tag prefixes, its commit window, and, for a
 * workspace or a directory other than the repo root, the scope to which change-record entries route, which is its name.
 */
export function describeHistoryWindow(target: ReleaseTarget): GenerateChangelogOptions {
  return {
    tagPrefixes: getAllTagPrefixes(target),
    ...(target.paths !== undefined && { paths: target.paths }),
    ...(isScopeRouted(target) && { scope: target.id }),
  };
}

/**
 * Decides a target's direct release from its window: `setVersion` releases at that version, and otherwise the
 * window's bump, `shouldForce`, and `bumpOverride` decide as {@link decideRelease} states.
 */
export function decideTargetRelease(
  target: ReleaseTarget,
  history: ReleaseHistory,
  options: { shouldForce: boolean; bumpOverride: ReleaseType | undefined; setVersion: string | undefined },
): TargetDecision {
  const { shouldForce, bumpOverride, setVersion } = options;
  if (setVersion !== undefined) {
    return { outcome: 'release', releaseType: undefined, bumpOverride: undefined, setVersion };
  }

  const tag = history.previousTag;
  const sinceClause = tag === undefined ? '(no previous release found)' : `since ${tag}`;
  const subject = isScopeRouted(target) || target.kind === 'directory' ? ` for ${target.id}` : '';
  const decision = decideRelease({
    naturalBump: history.unreleasedReading.bump,
    commitCount: history.unreleasedReading.commits.length,
    shouldForce,
    bumpOverride,
    skipReasons: {
      noCommits: `No commits${subject} ${sinceClause}. Pass --force to release at patch. Skipping.`,
      noBumpWorthy: `No bump-worthy commits${subject} ${sinceClause}. Pass --force to release at patch (or --force --bump=X for a different level). Skipping.`,
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

  const bumpPlan =
    setVersion === undefined
      ? planVersionBump(target.versionFiles, release.releaseType)
      : planVersionSet(target.versionFiles, setVersion);
  const tag = `${target.tagPrefix}${bumpPlan.newVersion}`;
  const writes: PlannedWrite[] = [...bumpPlan.writes];

  const entries =
    decision === undefined
      ? buildPropagationEntries(target, release, bumpPlan.newVersion, today, args.dependenciesHeader)
      : convertToReleaseEntries(history, tag, today);
  const overrideScope = describeOverrideScope(target);
  const appliedOverrides = applyWorkspaceOverrides(entries, overrideScope, overrideContext);

  const changelogPlan = planChangelogFiles(target.changelogDir, appliedOverrides.entries, settings, sectionOrder);
  writes.push(...changelogPlan.writes);

  const warnings: string[] = [];
  const previewFiles: string[] = [];
  if (shouldPlanPreviews) {
    const previewsPlan = planReleaseNotesPreviews({
      workspacePath: target.changelogDir,
      tag,
      entries: changelogPlan.entries,
      sectionOrder,
    });
    writes.push(...previewsPlan.writes);
    warnings.push(...previewsPlan.warnings);
    previewFiles.push(...previewsPlan.writes.map((write) => write.path));
  }

  const releaseFields = {
    targetId: target.id,
    commitCount: history.unreleasedReading.commits.length,
    currentVersion: bumpPlan.currentVersion,
    newVersion: bumpPlan.newVersion,
    tag,
    bumpedFiles: bumpPlan.writes.map((write) => write.path),
    changelogFiles: changelogPlan.changelogFiles,
    ...(changelogPlan.removals.length > 0 && { removedChangelogFiles: changelogPlan.removals }),
    ...(previewFiles.length > 0 && { previewFiles }),
    ...(changelogPlan.preservation !== undefined && { changelogPreservation: [changelogPlan.preservation] }),
    ...(history.previousTag !== undefined && { previousTag: history.previousTag }),
  };
  const result = buildReleasedResult(target, releaseFields, release, decision, history);

  return {
    result,
    tag,
    writes,
    removals: changelogPlan.removals,
    modifiedFiles: [...target.versionFiles, ...changelogPlan.changelogFiles, ...changelogPlan.changelogJsonFiles],
    warnings,
  };
}

/** Builds the result of a target that skips, from the window that its read produced. */
export function buildSkippedTargetResult(
  target: ReleaseTarget,
  history: ReleaseHistory,
  skipReason: string,
): TargetPrepareResult {
  const { unreleasedReading } = history;
  const fields = {
    targetId: target.id,
    status: 'skipped' as const,
    commitCount: unreleasedReading.commits.length,
    parsedCommitCount: unreleasedReading.parsedCommitCount,
    skipReason,
    ...(history.previousTag !== undefined && { previousTag: history.previousTag }),
    ...(unreleasedReading.unparseableCommits !== undefined && {
      unparseableCommits: unreleasedReading.unparseableCommits,
    }),
  };
  const skippedResult = labelSkippedResult(target, fields);
  attachChangelogDiagnostics(skippedResult, unreleasedReading.diagnostics);
  return skippedResult;
}

/** Reports whether a directory target is the repo root, which reads the whole repo and renders every entry. */
export function isRepoRoot(target: DirectoryTarget): boolean {
  return target.directoryPath === '.';
}

// region | Helpers
/** Names a target in the untagged-baseline error. */
function describeBaselineLabel(target: ReleaseTarget): string {
  switch (target.kind) {
    case 'composite':
      return target.id === PROJECT_TARGET_ID ? 'project' : `composite '${target.id}'`;
    case 'directory':
      return `directory '${target.id}'`;
    case 'package':
      return target.isWorkspace ? `workspace '${target.id}'` : 'package';
  }
}

/** Adds the kind of the target, and a workspace's or a directory's name, to the fields of its skipped result. */
function labelSkippedResult(
  target: ReleaseTarget,
  fields: Omit<SkippedPackageResult, 'kind' | 'name'>,
): SkippedCompositeResult | SkippedDirectoryResult | SkippedPackageResult {
  switch (target.kind) {
    case 'package':
      return { ...fields, kind: 'package', ...(target.isWorkspace && { name: target.id }) };
    case 'directory':
      return { ...fields, kind: 'directory', name: target.id };
    case 'composite':
      return { ...fields, kind: 'composite' };
  }
}

/**
 * Returns the directory whose override file composes with the root's for a target, or `undefined` for a target that
 * reads the root's alone: a composite, and the directory target at the repo root.
 */
function describeOverrideScope(target: ReleaseTarget): string | undefined {
  switch (target.kind) {
    case 'package':
      return target.packagePath;
    case 'directory':
      return isRepoRoot(target) ? undefined : target.directoryPath;
    case 'composite':
      return undefined;
  }
}

/**
 * Reports whether change-record entries route to the target by its name: a workspace, and a directory other than the
 * repo root.
 */
function isScopeRouted(target: ReleaseTarget): boolean {
  if (target.kind === 'directory') {
    return !isRepoRoot(target);
  }
  return target.kind === 'package' && target.isWorkspace;
}

// endregion | Helpers
