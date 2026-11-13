import { attachChangelogDiagnostics } from './attachChangelogDiagnostics.ts';
import {
  convertToChangelogEntries,
  type ReleaseHistory,
  sortSectionsCanonically,
  stripGroupDecorations,
} from './buildChangelogEntries.ts';
import { buildSyntheticChangelogEntry } from './buildSyntheticChangelogEntry.ts';
import type {
  ChangelogEntry,
  ChangelogSection,
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

/** The inputs from which `buildPropagationEntries` builds a propagated release's entries. */
export interface PropagationEntryArgs {
  history: ReleaseHistory;
  tag: string;
  newVersion: string;
  today: string;
  dependenciesHeader: string;
}

/**
 * Builds the entries of a release that propagation alone set: the window's own entries with the dependencies added to
 * the new version's section under the dependencies header, or, when the window doesn't yield any item, the one
 * synthetic entry under that header.
 */
export function buildPropagationEntries(
  target: ReleaseTarget,
  release: TargetRelease,
  args: PropagationEntryArgs,
): ChangelogEntry[] {
  if (release.propagatedFrom === undefined) {
    throw new Error(`Workspace '${target.id}' has neither a direct release nor a propagation source`);
  }
  const { history, tag, newVersion, today, dependenciesHeader } = args;
  const synthetic = buildSyntheticChangelogEntry(release.propagatedFrom, newVersion, today, dependenciesHeader);
  const [newEntry, ...releasedEntries] = convertToChangelogEntries(history, tag);
  if (history.unreleasedReading.sections.length === 0 || newEntry === undefined) {
    return [synthetic];
  }
  return [{ ...newEntry, sections: mergeSections(newEntry.sections, synthetic.sections) }, ...releasedEntries];
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
  const { unreleasedReading } = history;
  const result: ReleasedCompositeResult = {
    ...fields,
    status: 'released',
    kind: 'composite',
    parsedCommitCount: unreleasedReading.parsedCommitCount,
    releaseType: release.releaseType,
    commits: unreleasedReading.commits,
    ...(unreleasedReading.unparseableCommits !== undefined && {
      unparseableCommits: unreleasedReading.unparseableCommits,
    }),
    ...(decision?.bumpOverride !== undefined && { bumpOverride: decision.bumpOverride }),
  };
  attachChangelogDiagnostics(result, unreleasedReading.diagnostics);
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
  const { unreleasedReading } = history;
  const setVersion = decision?.setVersion;
  const result: ReleasedDirectoryResult = {
    ...fields,
    status: 'released',
    kind: 'directory',
    name: target.id,
    commits: unreleasedReading.commits,
    ...(setVersion === undefined && {
      releaseType: release.releaseType,
      parsedCommitCount: unreleasedReading.parsedCommitCount,
    }),
    ...(decision?.bumpOverride !== undefined && { bumpOverride: decision.bumpOverride }),
    ...(setVersion !== undefined && { versionOverride: setVersion }),
  };
  if (setVersion === undefined && unreleasedReading.unparseableCommits !== undefined) {
    result.unparseableCommits = unreleasedReading.unparseableCommits;
  }
  attachChangelogDiagnostics(result, unreleasedReading.diagnostics);
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
  const { unreleasedReading } = history;
  const setVersion = decision?.setVersion;
  const hasParseCounts = decision !== undefined && setVersion === undefined;
  const result: ReleasedPackageResult = {
    ...fields,
    status: 'released',
    kind: 'package',
    commits: unreleasedReading.commits,
    ...(target.isWorkspace && { name: target.id }),
    ...(setVersion === undefined && { releaseType: release.releaseType }),
    ...(hasParseCounts && { parsedCommitCount: unreleasedReading.parsedCommitCount }),
    ...(decision === undefined && { propagatedOnly: true as const }),
    ...(release.propagatedFrom !== undefined && { propagatedFrom: release.propagatedFrom }),
    ...(decision?.bumpOverride !== undefined && { bumpOverride: decision.bumpOverride }),
    ...(setVersion !== undefined && { versionOverride: setVersion }),
  };
  if (setVersion === undefined && unreleasedReading.unparseableCommits !== undefined) {
    result.unparseableCommits = unreleasedReading.unparseableCommits;
  }
  attachChangelogDiagnostics(result, unreleasedReading.diagnostics);
  return result;
}

/** Merges `added` into `sections`, appending the items of a section whose bare title matches an existing one. */
function mergeSections(sections: readonly ChangelogSection[], added: readonly ChangelogSection[]): ChangelogSection[] {
  const merged = [...sections];
  for (const section of added) {
    const index = merged.findIndex(
      (existing) => stripGroupDecorations(existing.title) === stripGroupDecorations(section.title),
    );
    const existing = merged[index];
    if (existing === undefined) {
      merged.push(section);
    } else {
      merged[index] = { ...existing, items: [...existing.items, ...section.items] };
    }
  }
  return sortSectionsCanonically(merged);
}
// endregion | Helpers
