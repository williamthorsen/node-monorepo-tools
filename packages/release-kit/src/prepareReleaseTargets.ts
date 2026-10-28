import { formatStaleOverrideKeyWarning } from './applyChangelogOverrides.ts';
import { assertTaggedBaseline } from './assertTaggedBaseline.ts';
import { buildDependencyGraph } from './buildDependencyGraph.ts';
import { buildReleaseSummary } from './buildReleaseSummary.ts';
import { createOverrideContext, type OverrideContext } from './changelogOverrides.ts';
import { decideDirectReleases, reportUnroutedEntryScopes } from './decideDirectReleases.ts';
import { deriveDependenciesHeader, deriveSectionOrder } from './deriveReleaseNotesConfig.ts';
import { findTransitiveDependents } from './findTransitiveDependents.ts';
import { hasPrettierConfig } from './hasPrettierConfig.ts';
import { resolveWorkTypes } from './mergeConfig.ts';
import { describeCompositeSkip, prepareComposite } from './prepareComposite.ts';
import {
  collect,
  type CollectedReleases,
  describeStage,
  isRepoRootTarget,
  type MemberTarget,
  readHistory,
  type RunContext,
  runStage,
} from './prepareRunContext.ts';
import { buildSkippedTargetResult, planTargetRelease, type TargetPrepareSettings } from './prepareTarget.ts';
import { propagateBumps } from './propagateBumps.ts';
import type { ReleasePlan } from './releasePlan.ts';
import { isSinglePackageTargets } from './resolveReleaseTargets.ts';
import { sortTopologically } from './topologicalSort.ts';
import type { ReleaseTarget, ReleaseType, TargetPrepareResult } from './types.ts';

/** The targets of a prepare run and the settings that they share. */
export interface TargetPrepareConfig {
  targets: ReleaseTarget[];
  settings: TargetPrepareSettings;
}

/** Options for the release preparation workflow. */
export interface TargetPrepareOptions {
  /**
   * Release even when the range since the last tag doesn't contain any commits or any bump-worthy commits.
   * Orthogonal to `bumpOverride`: When `bumpOverride` is not given, the release falls back to `patch`.
   */
  shouldForce?: boolean;
  /** Level of the release, in place of the level that the changelog items call for; it doesn't trigger a release. */
  bumpOverride?: ReleaseType;
  /**
   * If true, plan release-notes previews under each released target's `docs/` (`README.v{version}.md` and
   * `RELEASE_NOTES.v{version}.md`) from its changelog entries. Requires `changelogJson.enabled`; when disabled, the
   * plan records a warning and doesn't plan any previews.
   */
  shouldIncludeReleaseNotes?: boolean;
  /**
   * Ids of the targets from which the release starts; the run plans the named package targets and their transitive
   * dependents, and each named composite, which reads its own window. Present only for a narrowed run, which skips
   * every composite that it doesn't name.
   */
  onlyTargetIds?: readonly string[];
  /**
   * Explicit versions (canonical `N.N.N`), keyed by package target id. Each named target starts the release and
   * releases at its version, which takes precedence over `bumpOverride` and `shouldForce`.
   */
  versionOverridesById?: ReadonlyMap<string, string>;
}

/** Warning recorded when release-notes previews are requested without the changelog JSON that they render from. */
const PREVIEWS_REQUIRE_JSON_WARNING =
  '--with-release-notes requires changelogJson.enabled; skipping preview generation';

/**
 * Plans a release over a list of targets, without writing any file.
 *
 * 1. Selects the planned package and directory targets: every one, or, under `onlyTargetIds`, those named and their
 *    transitive dependents.
 * 2. Reads each planned target's history and decides its direct release.
 * 3. Propagates bumps to dependents, asserts the baselines that matter, and sorts the release set topologically.
 * 4. Plans each release in dependency order.
 * 5. Prepares each composite after every package target, unless `onlyTargetIds` narrowed the run without naming it.
 * 6. Renders the format command over the modified files.
 */
export function prepareReleaseTargets(config: TargetPrepareConfig, options: TargetPrepareOptions): ReleasePlan {
  const { settings } = config;
  const { onlyTargetIds, shouldIncludeReleaseNotes } = options;
  const isSinglePackage = isSinglePackageTargets(config.targets);
  const memberTargets = config.targets.filter((target) => target.kind !== 'composite');
  const compositeTargets = config.targets.filter((target) => target.kind === 'composite');
  const warnings: string[] = [];

  // -- Selection --
  const graph = buildDependencyGraph(
    memberTargets.filter((target) => target.kind === 'package').filter((target) => target.isWorkspace),
  );
  const startIds = selectStartIds(memberTargets, options);
  const plannedIds = findTransitiveDependents(graph, startIds);
  const plannedTargets = memberTargets.filter((target) => plannedIds.has(target.id));

  const arePreviewsBlocked = shouldIncludeReleaseNotes === true && !settings.changelogJson.enabled;
  if (arePreviewsBlocked && !isSinglePackage) {
    warnings.push(PREVIEWS_REQUIRE_JSON_WARNING);
  }

  const workTypes = resolveWorkTypes(settings.workTypes);
  const context: RunContext = {
    settings,
    overrideContext: createOverrideContext(plannedTargets.flatMap(listOverrideDirectory)),
    sectionOrder: deriveSectionOrder(workTypes),
    dependenciesHeader: deriveDependenciesHeader(workTypes),
    shouldPlanPreviews: shouldIncludeReleaseNotes === true && settings.changelogJson.enabled,
    today: new Date().toISOString().slice(0, 10),
  };

  // -- Direct releases --
  const directReleases = decideDirectReleases(plannedTargets, settings, options, startIds);
  if (!isSinglePackage) {
    reportUnroutedEntryScopes(plannedTargets, directReleases, settings, memberTargets);
  }

  // -- Propagation --
  const releaseSet = propagateBumps(directReleases.bumps, graph);
  // A target that releases through propagation alone doesn't render any entry from its window, so its baseline does
  // not matter. Throw outside any stage so that one error names every other target's missing tag.
  assertTaggedBaseline(
    [...directReleases.untaggedBaselines]
      .filter(([id]) => directReleases.bumps.has(id) || !releaseSet.has(id))
      .map(([, untagged]) => untagged),
  );
  const { sortedIds, cyclicIds } = sortTopologically(releaseSet, graph);
  if (cyclicIds.length > 0) {
    warnings.push(
      `Circular workspace dependencies detected among: ${cyclicIds.join(', ')}. ` +
        'Propagation metadata may be incomplete for these workspaces.',
    );
  }

  // -- Package releases, in dependency order --
  const resultsById = new Map<string, TargetPrepareResult>();
  for (const target of plannedTargets) {
    const decision = directReleases.decisions.get(target.id);
    if (decision?.outcome === 'skip' && !releaseSet.has(target.id)) {
      resultsById.set(
        target.id,
        buildSkippedTargetResult(target, readHistory(directReleases.readings, target), decision.skipReason),
      );
    }
  }
  const collectedReleases: CollectedReleases = { tags: [], writes: [], removals: [], modifiedFiles: [] };
  for (const id of sortedIds) {
    const target = plannedTargets.find((candidate) => candidate.id === id);
    const release = releaseSet.get(id);
    if (target === undefined || release === undefined) {
      continue;
    }
    const decision = directReleases.decisions.get(id);
    const plannedRelease = runStage(describeStage(target), () =>
      planTargetRelease({
        ...context,
        target,
        release,
        decision: decision?.outcome === 'release' ? decision : undefined,
        history: readHistory(directReleases.readings, target),
      }),
    );
    collect(collectedReleases, plannedRelease);
    warnings.push(...plannedRelease.warnings);
    resultsById.set(id, plannedRelease.result);
  }
  const results: TargetPrepareResult[] = plannedTargets.flatMap((target) => resultsById.get(target.id) ?? []);

  // -- Composites, after every package target --
  for (const composite of compositeTargets) {
    const skipWarning = describeCompositeSkip(composite, onlyTargetIds);
    if (skipWarning !== undefined) {
      warnings.push(skipWarning);
      continue;
    }
    const result = runStage(describeStage(composite), () =>
      prepareComposite(composite, context, options, collectedReleases, warnings),
    );
    results.push(result);
  }

  // -- Format command --
  const formatCommand = planFormatCommand(settings.formatCommand, collectedReleases);

  // Warn once per root key that did not match in any target. Each workspace's apply already warned about its own
  // stale keys.
  const { overrideContext } = context;
  for (const overrideKey of overrideContext.projectOverrides.keys()) {
    if (!overrideContext.globalMatchedRootKeys.has(overrideKey)) {
      overrideContext.overrideWarnings.push(formatStaleOverrideKeyWarning(overrideKey));
    }
  }

  const allWarnings = isSinglePackage
    ? composeSinglePackageWarnings(collectedReleases, overrideContext, arePreviewsBlocked, warnings)
    : [...warnings, ...overrideContext.overrideWarnings];

  return {
    targets: results,
    tags: collectedReleases.tags,
    writes: collectedReleases.writes,
    removals: collectedReleases.removals,
    summary: buildReleaseSummary({ targets: results }),
    formatCommand,
    ...(allWarnings.length > 0 && { warnings: allWarnings }),
  };
}

// region | Helpers

/**
 * Orders the warnings of a single-package run: the override warnings, then the preview warnings. A run that does not
 * release reports none.
 */
function composeSinglePackageWarnings(
  collectedReleases: CollectedReleases,
  overrideContext: OverrideContext,
  arePreviewsBlocked: boolean,
  previewWarnings: readonly string[],
): string[] {
  if (collectedReleases.tags.length === 0) {
    return [];
  }
  return [
    ...overrideContext.overrideWarnings,
    ...(arePreviewsBlocked ? [PREVIEWS_REQUIRE_JSON_WARNING] : []),
    ...previewWarnings,
  ];
}

/**
 * Returns the directory whose override file a planned target composes with the root's: a workspace's package path, and
 * a directory's path unless it is the repo root, which reads the root's alone.
 */
function listOverrideDirectory(target: MemberTarget): string[] {
  if (target.kind === 'directory') {
    return isRepoRootTarget(target) ? [] : [target.directoryPath];
  }
  return target.isWorkspace ? [target.packagePath] : [];
}

/**
 * Renders the format command over the modified files, if configured and the plan contains a release.
 *
 * The command is not run here: It reformats the very files that the plan has yet to write, so the
 * caller runs it once the plan is on disk.
 */
function planFormatCommand(
  configuredCommand: string | undefined,
  collectedReleases: CollectedReleases,
): ReleasePlan['formatCommand'] {
  const baseCommand = configuredCommand ?? (hasPrettierConfig() ? 'npx prettier --write' : undefined);

  if (collectedReleases.tags.length === 0 || baseCommand === undefined) {
    return undefined;
  }

  const files = collectedReleases.modifiedFiles;
  return { command: `${baseCommand} ${files.join(' ')}`, files };
}

/**
 * Returns the ids of the package and directory targets from which the release starts: every one, or, when
 * `onlyTargetIds` narrows the run, those named by `onlyTargetIds` or `versionOverridesById`.
 */
function selectStartIds(memberTargets: readonly MemberTarget[], options: TargetPrepareOptions): Set<string> {
  const { onlyTargetIds, versionOverridesById } = options;
  if (onlyTargetIds === undefined) {
    return new Set(memberTargets.map((target) => target.id));
  }
  return new Set([...onlyTargetIds, ...(versionOverridesById?.keys() ?? [])]);
}

// endregion | Helpers
