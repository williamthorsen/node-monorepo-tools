import { chainError } from '@williamthorsen/toolbelt.errors/candidate';

import type { ReleaseHistory } from './buildChangelogEntries.ts';
import type { OverrideContext } from './changelogOverrides.ts';
import { isRepoRoot, type TargetPrepareSettings } from './prepareTarget.ts';
import type { PlannedWrite } from './releasePlan.ts';
import type { DirectoryTarget, PackageTarget, ReleaseTarget } from './types.ts';

/** Appends one planned release's tag, writes, removals, and modified files to the run's collection. */
export function collect(
  collected: CollectedReleases,
  planned: { tag: string; writes: PlannedWrite[]; removals: string[]; modifiedFiles: string[] },
): void {
  collected.tags.push(planned.tag);
  collected.writes.push(...planned.writes);
  collected.removals.push(...planned.removals);
  collected.modifiedFiles.push(...planned.modifiedFiles);
}

/** The tags, writes, removals, and modified files of the run's releases, in the order in which they were planned. */
export interface CollectedReleases {
  tags: string[];
  writes: PlannedWrite[];
  removals: string[];
  modifiedFiles: string[];
}

/** Names the stage whose errors a target's work raises; the single-package root's errors are not labeled. */
export function describeStage(target: ReleaseTarget): string | undefined {
  switch (target.kind) {
    case 'composite':
      return 'project release stage';
    case 'directory':
      return `directory '${target.id}' release stage`;
    case 'package':
      return target.isWorkspace ? `workspace '${target.id}' release stage` : undefined;
  }
}

/** Reports whether a target is the directory target of the repo root, whose window is the whole repo. */
export function isRepoRootTarget(target: MemberTarget): boolean {
  return target.kind === 'directory' && isRepoRoot(target);
}

/** A target that releases on its own window and takes part in selection: a package or a directory. */
export type MemberTarget = PackageTarget | DirectoryTarget;

/** Returns the history that the direct-release pass read for a planned target. */
export function readHistory(readings: ReadonlyMap<string, ReleaseHistory>, target: MemberTarget): ReleaseHistory {
  const history = readings.get(target.id);
  if (history === undefined) {
    throw new Error(`Target '${target.id}' was planned without a history`);
  }
  return history;
}

/** What every target's planning reads from the run. */
export interface RunContext {
  settings: TargetPrepareSettings;
  overrideContext: OverrideContext;
  sectionOrder: string[];
  dependenciesHeader: string;
  shouldPlanPreviews: boolean;
  today: string;
}

/** Runs `fn`, rethrowing any thrown value behind the stage label as `<stage>: …`; runs it unlabeled without one. */
export function runStage<T>(stage: string | undefined, fn: () => T): T {
  if (stage === undefined) {
    return fn();
  }
  try {
    return fn();
  } catch (error) {
    throw chainError(stage, error);
  }
}
