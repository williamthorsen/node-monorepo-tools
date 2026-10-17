import { attachChangelogDiagnostics } from './attachChangelogDiagnostics.ts';
import type { ReleaseHistory } from './buildChangelogEntries.ts';
import { buildSyntheticChangelogEntry } from './buildSyntheticChangelogEntry.ts';
import type {
  ChangelogEntry,
  DirectoryTarget,
  PropagationSource,
  ReleasedCompositeResult,
  ReleasedDirectoryResult,
  ReleasedPackageResult,
  ReleasedTargetResult,
  ReleaseTarget,
  ReleaseType,
} from './types.ts';

/** The release level that a target takes, whether its own commits or a dependency's bump decided it. */
export interface TargetRelease {
  releaseType: ReleaseType;
  /** Dependencies whose bumps this release records; present for a propagated or mixed release. */
  propagatedFrom?: PropagationSource[];
}

/** The fields of a direct release decision that a released result records; undefined for a propagated release. */
interface ReleaseDecisionFields {
  bumpOverride: ReleaseType | undefined;
  setVersion: string | undefined;
}

/** The fields that a released result of either kind takes from the plan. */
type ReleaseResultFields = Omit<
  ReleasedCompositeResult,
  'commits' | 'kind' | 'parsedCommitCount' | 'releaseType' | 'status'
>;

/** Builds the one synthetic entry of a release that propagation alone set, under the dependencies header. */
export function buildPropagationEntries(
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

/** Builds the released result of a target from the plan's fields, by the target's kind. */
export function buildReleasedResult(
  target: ReleaseTarget,
  fields: ReleaseResultFields,
  release: TargetRelease,
  decision: ReleaseDecisionFields | undefined,
  history: ReleaseHistory,
): ReleasedTargetResult {
  switch (target.kind) {
    case 'package':
      return buildReleasedPackage(target, fields, release, decision, history);
    case 'directory':
      return buildReleasedDirectory(target, fields, release, decision, history);
    case 'composite':
      return buildReleasedComposite(fields, release, decision, history);
  }
}

// region | Helpers

/** Builds the released result of a composite target, which a direct decision always releases at a level. */
function buildReleasedComposite(
  fields: ReleaseResultFields,
  release: TargetRelease,
  decision: ReleaseDecisionFields | undefined,
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
 * Builds the released result of a directory target, whose release a direct decision always sets. `--set-version`
 * leaves `releaseType` and the parse counts off, as it does for a package.
 */
function buildReleasedDirectory(
  target: DirectoryTarget,
  fields: ReleaseResultFields,
  release: TargetRelease,
  decision: ReleaseDecisionFields | undefined,
  history: ReleaseHistory,
): ReleasedDirectoryResult {
  const { unreleased } = history;
  const setVersion = decision?.setVersion;
  const result: ReleasedDirectoryResult = {
    ...fields,
    status: 'released',
    kind: 'directory',
    name: target.id,
    commits: unreleased.commits,
    ...(setVersion === undefined && {
      releaseType: release.releaseType,
      parsedCommitCount: unreleased.parsedCommitCount,
    }),
    ...(decision?.bumpOverride !== undefined && { bumpOverride: decision.bumpOverride }),
    ...(setVersion !== undefined && { setVersion }),
  };
  if (setVersion === undefined && unreleased.unparseableCommits !== undefined) {
    result.unparseableCommits = unreleased.unparseableCommits;
  }
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
  decision: ReleaseDecisionFields | undefined,
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
    ...(target.isWorkspace && { name: target.id }),
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

// endregion | Helpers
