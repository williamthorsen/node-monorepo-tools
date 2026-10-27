import type { UntaggedBaseline } from './assertTaggedBaseline.ts';
import type { ReleaseHistory } from './buildChangelogEntries.ts';
import { detectUndeclaredTagPrefixes } from './detectUndeclaredTagPrefixes.ts';
import { findUnroutedEntryScopes } from './findUnroutedEntryScopes.ts';
import { getAllTagPrefixes } from './generateChangelogs.ts';
import { describeStage, isRepoRootTarget, type MemberTarget, readHistory, runStage } from './prepareRunContext.ts';
import {
  decideTargetRelease,
  readTargetHistory,
  type TargetDecision,
  type TargetPrepareSettings,
} from './prepareTarget.ts';
import type { ReleaseEntry } from './propagateBumps.ts';
import type { PackageTarget, ReleaseType } from './types.ts';

/** The direct releases of the planned package targets, with the reads from which they were decided. */
export interface DirectReleases {
  readings: Map<string, ReleaseHistory>;
  decisions: Map<string, TargetDecision>;
  /** The bumps from which propagation starts: one per target whose decision releases. */
  bumps: Map<string, ReleaseEntry>;
  untaggedBaselines: Map<string, UntaggedBaseline>;
}

/**
 * Reads each planned package and directory target's history and decides its direct release. `shouldForce` applies only to
 * the targets from which the release starts.
 */
export function decideDirectReleases(
  plannedTargets: readonly MemberTarget[],
  settings: TargetPrepareSettings,
  options: { shouldForce?: boolean; bumpOverride?: ReleaseType; setVersions?: ReadonlyMap<string, string> },
  startIds: ReadonlySet<string>,
): DirectReleases {
  const { shouldForce, bumpOverride, setVersions } = options;
  const directReleases: DirectReleases = {
    readings: new Map(),
    decisions: new Map(),
    bumps: new Map(),
    untaggedBaselines: new Map(),
  };
  const hintState: BaselineHintState = { emitted: false };
  // The union of every planned workspace's derived and declared prefixes, so that the baseline hint doesn't count a
  // sibling's tags as undeclared candidates.
  const knownPrefixes = plannedTargets.flatMap(getAllTagPrefixes);

  for (const target of plannedTargets) {
    const { history, untaggedBaseline } = runStage(describeStage(target), () => readTargetHistory(target, settings));
    directReleases.readings.set(target.id, history);
    if (untaggedBaseline !== undefined) {
      directReleases.untaggedBaselines.set(target.id, untaggedBaseline);
    }
    if (history.previousTag === undefined && target.kind === 'package' && target.isWorkspace) {
      maybeEmitBaselineHint(target, knownPrefixes, hintState);
    }

    const setVersion = setVersions?.get(target.id);
    const decision = decideTargetRelease(target, history, {
      shouldForce: shouldForce === true && startIds.has(target.id),
      bumpOverride,
      setVersion,
    });
    directReleases.decisions.set(target.id, decision);
    if (decision.outcome === 'skip') {
      continue;
    }
    // With `--set-version`, the release type is a sentinel: `newVersionOverride` takes precedence when propagation
    // computes dependent versions.
    directReleases.bumps.set(
      target.id,
      decision.setVersion === undefined
        ? { releaseType: decision.releaseType }
        : { releaseType: 'patch', newVersionOverride: decision.setVersion },
    );
  }

  return directReleases;
}

/**
 * Records on each planned workspace's and directory's history the entry scopes that route nowhere in its unreleased
 * window, which only a pass across every target's window can find. The windows go to the finder with the releasing
 * targets first, in planned order, which sets the order of each target's findings. The repo-root directory target
 * renders every entry in its window, so it records none, but its window still routes the scope that names it.
 */
export function reportUnroutedEntryScopes(
  plannedTargets: readonly MemberTarget[],
  directReleases: DirectReleases,
  settings: TargetPrepareSettings,
  memberTargets: readonly MemberTarget[],
): void {
  const releasingTargets = plannedTargets.filter(
    (target) => directReleases.decisions.get(target.id)?.outcome === 'release',
  );
  const windows = [...releasingTargets, ...plannedTargets.filter((target) => !releasingTargets.includes(target))].map(
    (target) => ({
      target,
      history: readHistory(directReleases.readings, target),
    }),
  );
  const findings = findUnroutedEntryScopes(
    windows.map(({ target, history }) => ({ dir: target.id, commits: history.unreleasedReading.commits })),
    memberTargets.map((target) => target.id),
    settings.scopeAliases ?? {},
  );
  for (const { target, history } of windows) {
    history.unreleasedReading.diagnostics.unroutedEntryScopes = isRepoRootTarget(target)
      ? []
      : (findings.get(target.id) ?? []);
  }
}

// region | Helpers

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
  target: PackageTarget,
  knownPrefixes: readonly string[],
  state: BaselineHintState,
): void {
  if (state.emitted || (target.legacyIdentities?.length ?? 0) > 0) return;

  const candidates = detectUndeclaredTagPrefixes(knownPrefixes);
  if (candidates.length === 0) return;

  const totalTags = candidates.reduce((sum, candidate) => sum + candidate.tagCount, 0);
  const exampleTag = candidates[0]?.exampleTags[0] ?? `${candidates[0]?.prefix ?? ''}?`;
  process.stderr.write(
    `Hint: no baseline tag found for ${target.id} under '${target.tagPrefix}', but ` +
      `${totalTags} candidate-shaped tags exist (e.g., ${exampleTag}). ` +
      "Run 'release-kit show-tag-prefixes' to check for undeclared legacy prefixes.\n",
  );
  state.emitted = true;
}

// endregion | Helpers
