import { chainError } from '@williamthorsen/toolbelt.errors/candidate';

import { assertTaggedBaseline, type UntaggedBaseline } from './assertTaggedBaseline.ts';
import type { ReleaseHistory } from './buildChangelogEntries.ts';
import { buildDependencyGraph, type DependencyGraph } from './buildDependencyGraph.ts';
import { buildReleaseSummary } from './buildReleaseSummary.ts';
import { createOverrideContext, formatStaleOverrideKeyWarning, type OverrideContext } from './changelogOverrides.ts';
import { deriveDependenciesHeader, deriveSectionOrder } from './deriveReleaseNotesConfig.ts';
import { detectUndeclaredTagPrefixes } from './detectUndeclaredTagPrefixes.ts';
import { findTransitiveDependents } from './findTransitiveDependents.ts';
import { findUnroutedEntryScopes } from './findUnroutedEntryScopes.ts';
import { getAllTagPrefixes } from './generateChangelogs.ts';
import { hasPrettierConfig } from './hasPrettierConfig.ts';
import { resolveWorkTypes } from './mergeConfig.ts';
import {
  buildSkippedTargetResult,
  decideTargetRelease,
  isRepoRoot,
  planTargetRelease,
  readTargetHistory,
  type TargetDecision,
  type TargetPrepareSettings,
} from './prepareTarget.ts';
import { propagateBumps, type ReleaseEntry } from './propagateBumps.ts';
import type { PlannedWrite, ReleasePlan } from './releasePlan.ts';
import { isSinglePackageTargets, PROJECT_TARGET_ID } from './resolveReleaseTargets.ts';
import type {
  CompositeTarget,
  DirectoryTarget,
  PackageTarget,
  ReleaseTarget,
  ReleaseType,
  TargetPrepareResult,
} from './types.ts';

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
  force?: boolean;
  /** Level of the release, in place of the level that the changelog items call for; it doesn't trigger a release. */
  bumpOverride?: ReleaseType;
  /**
   * If true, plan release-notes previews under each released target's `docs/` (`README.v{version}.md` and
   * `RELEASE_NOTES.v{version}.md`) from its changelog entries. Requires `changelogJson.enabled`; when disabled, the
   * plan records a warning and doesn't plan any previews.
   */
  withReleaseNotes?: boolean;
  /**
   * Ids of the targets from which the release starts; the run plans the named package targets and their transitive
   * dependents, and each named composite, which reads its own window. Present only for a narrowed run, which skips
   * every composite that it doesn't name.
   */
  only?: readonly string[];
  /**
   * Explicit versions (canonical `N.N.N`), keyed by package target id. Each named target starts the release and
   * releases at its version, which takes precedence over `bumpOverride` and `force`.
   */
  setVersions?: ReadonlyMap<string, string>;
}

/** Warning recorded when release-notes previews are requested without the changelog JSON that they render from. */
const PREVIEWS_REQUIRE_JSON_WARNING =
  '--with-release-notes requires changelogJson.enabled; skipping preview generation';

/**
 * Plans a release over a list of targets, without writing any file.
 *
 * 1. Selects the planned package and directory targets: every one, or, under `only`, those named and their transitive
 *    dependents.
 * 2. Reads each planned target's history and decides its direct release.
 * 3. Propagates bumps to dependents, asserts the baselines that matter, and sorts the release set topologically.
 * 4. Plans each release in dependency order.
 * 5. Prepares each composite after every package target, unless `only` narrowed the run without naming it.
 * 6. Renders the format command over the modified files.
 */
export function releasePrepareTargets(config: TargetPrepareConfig, options: TargetPrepareOptions): ReleasePlan {
  const { settings } = config;
  const { only, withReleaseNotes } = options;
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
  const planned = memberTargets.filter((target) => plannedIds.has(target.id));

  const arePreviewsBlocked = withReleaseNotes === true && !settings.changelogJson.enabled;
  if (arePreviewsBlocked && !isSinglePackage) {
    warnings.push(PREVIEWS_REQUIRE_JSON_WARNING);
  }

  const workTypes = resolveWorkTypes(settings.workTypes);
  const context: RunContext = {
    settings,
    overrideContext: createOverrideContext(planned.flatMap(listOverrideDirectory)),
    sectionOrder: deriveSectionOrder(workTypes),
    dependenciesHeader: deriveDependenciesHeader(workTypes),
    shouldPlanPreviews: withReleaseNotes === true && settings.changelogJson.enabled,
    today: new Date().toISOString().slice(0, 10),
  };

  // -- Direct releases --
  const direct = decideDirectReleases(planned, settings, options, startIds);
  if (!isSinglePackage) {
    reportUnroutedEntryScopes(planned, direct, settings, memberTargets);
  }

  // -- Propagation --
  const releaseSet = propagateBumps(direct.bumps, graph);
  // A target that releases through propagation alone doesn't render any entry from its window, so its baseline does
  // not matter. Throw outside any stage so that one error names every other target's missing tag.
  assertTaggedBaseline(
    [...direct.untaggedBaselines]
      .filter(([id]) => direct.bumps.has(id) || !releaseSet.has(id))
      .map(([, untagged]) => untagged),
  );
  const { sorted: sortedIds, cyclicIds } = topologicalSort(releaseSet, graph);
  if (cyclicIds.length > 0) {
    warnings.push(
      `Circular workspace dependencies detected among: ${cyclicIds.join(', ')}. ` +
        'Propagation metadata may be incomplete for these workspaces.',
    );
  }

  // -- Package releases, in dependency order --
  const resultsById = new Map<string, TargetPrepareResult>();
  for (const target of planned) {
    const decision = direct.decisions.get(target.id);
    if (decision?.outcome === 'skip' && !releaseSet.has(target.id)) {
      resultsById.set(
        target.id,
        buildSkippedTargetResult(target, readHistory(direct.readings, target), decision.skipReason),
      );
    }
  }
  const collected: CollectedReleases = { tags: [], writes: [], removals: [], modifiedFiles: [] };
  for (const id of sortedIds) {
    const target = planned.find((candidate) => candidate.id === id);
    const release = releaseSet.get(id);
    if (target === undefined || release === undefined) {
      continue;
    }
    const decision = direct.decisions.get(id);
    const plannedRelease = runStage(describeStage(target), () =>
      planTargetRelease({
        ...context,
        target,
        release,
        decision: decision?.outcome === 'release' ? decision : undefined,
        history: readHistory(direct.readings, target),
      }),
    );
    collect(collected, plannedRelease);
    warnings.push(...plannedRelease.warnings);
    resultsById.set(id, plannedRelease.result);
  }
  const results: TargetPrepareResult[] = planned.flatMap((target) => resultsById.get(target.id) ?? []);

  // -- Composites, after every package target --
  for (const composite of compositeTargets) {
    const skipWarning = describeCompositeSkip(composite, only);
    if (skipWarning !== undefined) {
      warnings.push(skipWarning);
      continue;
    }
    const result = runStage(describeStage(composite), () =>
      prepareComposite(composite, context, options, collected, warnings),
    );
    results.push(result);
  }

  // -- Format command --
  const formatCommand = planFormatCommand(settings.formatCommand, collected);

  // Warn once per root key that did not match in any target. Each workspace's apply already warned about its own
  // stale keys.
  const { overrideContext } = context;
  for (const overrideKey of overrideContext.project.keys()) {
    if (!overrideContext.globalMatchedRootKeys.has(overrideKey)) {
      overrideContext.overrideWarnings.push(formatStaleOverrideKeyWarning(overrideKey));
    }
  }

  const allWarnings = isSinglePackage
    ? composeSinglePackageWarnings(collected, overrideContext, arePreviewsBlocked, warnings)
    : [...warnings, ...overrideContext.overrideWarnings];

  return {
    targets: results,
    tags: collected.tags,
    writes: collected.writes,
    removals: collected.removals,
    summary: buildReleaseSummary({ targets: results }),
    formatCommand,
    ...(allWarnings.length > 0 && { warnings: allWarnings }),
  };
}

// region | Helpers

/** What every target's planning reads from the run. */
interface RunContext {
  settings: TargetPrepareSettings;
  overrideContext: OverrideContext;
  sectionOrder: string[];
  dependenciesHeader: string;
  shouldPlanPreviews: boolean;
  today: string;
}

/** A target that releases on its own window and takes part in selection: a package or a directory. */
type MemberTarget = PackageTarget | DirectoryTarget;

/** The tags, writes, removals, and modified files of the run's releases, in the order in which they were planned. */
interface CollectedReleases {
  tags: string[];
  writes: PlannedWrite[];
  removals: string[];
  modifiedFiles: string[];
}

/** The direct releases of the planned package targets, with the reads from which they were decided. */
interface DirectReleases {
  readings: Map<string, ReleaseHistory>;
  decisions: Map<string, TargetDecision>;
  /** The bumps from which propagation starts: one per target whose decision releases. */
  bumps: Map<string, ReleaseEntry>;
  untaggedBaselines: Map<string, UntaggedBaseline>;
}

/** Shared single-fire flag so that multiple no-baseline workspaces trigger at most one hint per run. */
interface BaselineHintState {
  emitted: boolean;
}

/** Appends one planned release's tag, writes, removals, and modified files to the run's collection. */
function collect(
  collected: CollectedReleases,
  planned: { tag: string; writes: PlannedWrite[]; removals: string[]; modifiedFiles: string[] },
): void {
  collected.tags.push(planned.tag);
  collected.writes.push(...planned.writes);
  collected.removals.push(...planned.removals);
  collected.modifiedFiles.push(...planned.modifiedFiles);
}

/**
 * Orders the warnings of a single-package run: the override warnings, then the preview warnings. A run that does not
 * release reports none.
 */
function composeSinglePackageWarnings(
  collected: CollectedReleases,
  overrideContext: OverrideContext,
  arePreviewsBlocked: boolean,
  previewWarnings: readonly string[],
): string[] {
  if (collected.tags.length === 0) {
    return [];
  }
  return [
    ...overrideContext.overrideWarnings,
    ...(arePreviewsBlocked ? [PREVIEWS_REQUIRE_JSON_WARNING] : []),
    ...previewWarnings,
  ];
}

/**
 * Reads each planned package and directory target's history and decides its direct release. `force` applies only to
 * the targets from which the release starts.
 */
function decideDirectReleases(
  planned: readonly MemberTarget[],
  settings: TargetPrepareSettings,
  options: TargetPrepareOptions,
  startIds: ReadonlySet<string>,
): DirectReleases {
  const { force, bumpOverride, setVersions } = options;
  const direct: DirectReleases = {
    readings: new Map(),
    decisions: new Map(),
    bumps: new Map(),
    untaggedBaselines: new Map(),
  };
  const hintState: BaselineHintState = { emitted: false };
  // The union of every planned workspace's derived and declared prefixes, so that the baseline hint doesn't count a
  // sibling's tags as undeclared candidates.
  const knownPrefixes = planned.flatMap(getAllTagPrefixes);

  for (const target of planned) {
    const { history, untagged } = runStage(describeStage(target), () => readTargetHistory(target, settings));
    direct.readings.set(target.id, history);
    if (untagged !== undefined) {
      direct.untaggedBaselines.set(target.id, untagged);
    }
    if (history.previousTag === undefined && target.kind === 'package' && target.isWorkspace) {
      maybeEmitBaselineHint(target, knownPrefixes, hintState);
    }

    const setVersion = setVersions?.get(target.id);
    const decision = decideTargetRelease(target, history, {
      force: force === true && startIds.has(target.id),
      bumpOverride,
      setVersion,
    });
    direct.decisions.set(target.id, decision);
    if (decision.outcome === 'skip') {
      continue;
    }
    // With `--set-version`, the release type is a sentinel: `newVersionOverride` takes precedence when propagation
    // computes dependent versions.
    direct.bumps.set(
      target.id,
      decision.setVersion === undefined
        ? { releaseType: decision.releaseType }
        : { releaseType: 'patch', newVersionOverride: decision.setVersion },
    );
  }

  return direct;
}

/**
 * Describes why a run narrowed by `only` skips a composite and how to include it, or returns `undefined` when the run
 * prepares it: every run that `only` doesn't narrow, and every one that names it. A `project` block's composite
 * cannot be named.
 */
function describeCompositeSkip(composite: CompositeTarget, only: readonly string[] | undefined): string | undefined {
  if (only === undefined || only.includes(composite.id)) {
    return undefined;
  }
  if (composite.id === PROJECT_TARGET_ID) {
    return (
      `Project release skipped: --only narrows this run to ${only.join(', ')}. ` +
      'Run `release-kit prepare` without --only to include the project release.'
    );
  }
  return `Release '${composite.id}' skipped: --only does not name it. Add ${composite.id} to --only to include it.`;
}

/** Names the stage whose errors a target's work raises; the single-package root's errors are not labeled. */
function describeStage(target: ReleaseTarget): string | undefined {
  switch (target.kind) {
    case 'composite':
      return 'project release stage';
    case 'directory':
      return `directory '${target.id}' release stage`;
    case 'package':
      return target.isWorkspace ? `workspace '${target.id}' release stage` : undefined;
  }
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
  target: PackageTarget,
  knownPrefixes: readonly string[],
  state: BaselineHintState,
): void {
  if (state.emitted || (target.legacyIdentities?.length ?? 0) > 0) return;

  const candidates = detectUndeclaredTagPrefixes(knownPrefixes);
  if (candidates.length === 0) return;

  const totalTags = candidates.reduce((sum, candidate) => sum + candidate.tagCount, 0);
  const example = candidates[0]?.exampleTags[0] ?? `${candidates[0]?.prefix ?? ''}?`;
  process.stderr.write(
    `Hint: no baseline tag found for ${target.id} under '${target.tagPrefix}', but ` +
      `${totalTags} candidate-shaped tags exist (e.g., ${example}). ` +
      "Run 'release-kit show-tag-prefixes' to check for undeclared legacy prefixes.\n",
  );
  state.emitted = true;
}

/**
 * Renders the format command over the modified files, if configured and the plan contains a release.
 *
 * The command is not run here: It reformats the very files that the plan has yet to write, so the
 * caller runs it once the plan is on disk.
 */
function planFormatCommand(
  configuredCommand: string | undefined,
  collected: CollectedReleases,
): ReleasePlan['formatCommand'] {
  const formatCommandStr = configuredCommand ?? (hasPrettierConfig() ? 'npx prettier --write' : undefined);

  if (collected.tags.length === 0 || formatCommandStr === undefined) {
    return undefined;
  }

  const files = collected.modifiedFiles;
  return { command: `${formatCommandStr} ${files.join(' ')}`, files };
}

/**
 * Prepares a composite target: reads its history, asserts its baseline, and decides and plans its release, appending
 * its tag, writes, and modified files to the run's collection and its preview warnings to `warnings`.
 */
function prepareComposite(
  composite: CompositeTarget,
  context: RunContext,
  options: TargetPrepareOptions,
  collected: CollectedReleases,
  warnings: string[],
): TargetPrepareResult {
  const { history, untagged } = readTargetHistory(composite, context.settings);
  assertTaggedBaseline([untagged]);

  const decision = decideTargetRelease(composite, history, {
    force: options.force === true,
    bumpOverride: options.bumpOverride,
    setVersion: undefined,
  });
  if (decision.outcome === 'skip') {
    return buildSkippedTargetResult(composite, history, decision.skipReason);
  }
  if (decision.setVersion !== undefined) {
    throw new Error('A composite target cannot take --set-version');
  }

  const planned = planTargetRelease({
    ...context,
    target: composite,
    release: { releaseType: decision.releaseType },
    decision,
    history,
  });
  collect(collected, planned);
  warnings.push(...planned.warnings);
  return planned.result;
}

/** Reports whether a target is the directory target of the repo root, whose window is the whole repo. */
function isRepoRootTarget(target: MemberTarget): boolean {
  return target.kind === 'directory' && isRepoRoot(target);
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

/** Returns the history that the direct-release pass read for a planned target. */
function readHistory(readings: ReadonlyMap<string, ReleaseHistory>, target: MemberTarget): ReleaseHistory {
  const history = readings.get(target.id);
  if (history === undefined) {
    throw new Error(`Target '${target.id}' was planned without a history`);
  }
  return history;
}

/**
 * Records on each planned workspace's and directory's history the entry scopes that route nowhere in its unreleased
 * window, which only a pass across every target's window can find. The windows go to the finder with the releasing
 * targets first, in planned order, which sets the order of each target's findings. The repo-root directory target
 * renders every entry in its window, so it records none, but its window still routes the scope that names it.
 */
function reportUnroutedEntryScopes(
  planned: readonly MemberTarget[],
  direct: DirectReleases,
  settings: TargetPrepareSettings,
  memberTargets: readonly MemberTarget[],
): void {
  const releasing = planned.filter((target) => direct.decisions.get(target.id)?.outcome === 'release');
  const windows = [...releasing, ...planned.filter((target) => !releasing.includes(target))].map((target) => ({
    target,
    history: readHistory(direct.readings, target),
  }));
  const findings = findUnroutedEntryScopes(
    windows.map(({ target, history }) => ({ dir: target.id, commits: history.unreleased.commits })),
    memberTargets.map((target) => target.id),
    settings.scopeAliases ?? {},
  );
  for (const { target, history } of windows) {
    history.unreleased.diagnostics.unroutedEntryScopes = isRepoRootTarget(target)
      ? []
      : (findings.get(target.id) ?? []);
  }
}

/** Runs `fn`, rethrowing any thrown value behind the stage label as `<stage>: …`; runs it unlabeled without one. */
function runStage<T>(stage: string | undefined, fn: () => T): T {
  if (stage === undefined) {
    return fn();
  }
  try {
    return fn();
  } catch (error) {
    throw chainError(stage, error);
  }
}

/**
 * Returns the ids of the package and directory targets from which the release starts: every one, or, when `only`
 * narrows the run, those named by `only` or `setVersions`.
 */
function selectStartIds(memberTargets: readonly MemberTarget[], options: TargetPrepareOptions): Set<string> {
  const { only, setVersions } = options;
  if (only === undefined) {
    return new Set(memberTargets.map((target) => target.id));
  }
  return new Set([...only, ...(setVersions?.keys() ?? [])]);
}

/**
 * Sorts target ids topologically so that dependencies are processed before their dependents.
 *
 * Uses Kahn's algorithm. Targets not in the release set are excluded. If the graph has
 * cycles, the remaining nodes are appended in arbitrary order and reported via `cyclicIds`.
 */
function topologicalSort(
  releaseSet: Map<string, ReleaseEntry>,
  graph: DependencyGraph,
): { sorted: string[]; cyclicIds: string[] } {
  const releaseIds = new Set(releaseSet.keys());
  if (releaseIds.size === 0) {
    return { sorted: [], cyclicIds: [] };
  }

  // Build a forward adjacency list (dependency -> dependent) restricted to the release set.
  const inDegree = new Map<string, number>();
  const forwardEdges = new Map<string, string[]>();

  for (const id of releaseIds) {
    inDegree.set(id, 0);
    forwardEdges.set(id, []);
  }

  // Add an edge for each dependency-dependent pair inside the release set.
  for (const [packageName, dependents] of graph.dependentsOf) {
    const dependencyId = graph.packageNameToDir.get(packageName);
    if (dependencyId === undefined || !releaseIds.has(dependencyId)) {
      continue;
    }

    for (const dependent of dependents) {
      if (!releaseIds.has(dependent.id)) {
        continue;
      }

      const edges = forwardEdges.get(dependencyId);
      if (edges !== undefined) {
        edges.push(dependent.id);
      }

      inDegree.set(dependent.id, (inDegree.get(dependent.id) ?? 0) + 1);
    }
  }

  // Kahn's algorithm.
  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) {
      break;
    }
    sorted.push(id);

    const dependents = forwardEdges.get(id) ?? [];
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
  const cyclicIds: string[] = [];
  for (const id of releaseIds) {
    if (sortedSet.has(id)) {
      continue;
    }

    sorted.push(id);
    cyclicIds.push(id);
  }

  return { sorted, cyclicIds };
}

// endregion | Helpers
