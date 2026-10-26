import { writeFileWithCheck } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { deleteFileIfExists } from './deleteFileIfExists.ts';
import { RELEASE_SUMMARY_FILE, RELEASE_TAGS_FILE } from './releaseFiles.ts';
import type { PrepareResult } from './types.ts';

/** One file that a release will write, with its complete intended content. */
export interface PlannedWrite {
  path: string;
  content: string;
}

/**
 * A write or removal that succeeded, and whether it created the file. A removal did not create its file, so recovery
 * restores it from git as it does a replaced file.
 */
interface AppliedWrite {
  path: string;
  created: boolean;
}

/** One step of applying a plan: writing a file, or removing one. */
type PlannedStep = ({ kind: 'write' } & PlannedWrite) | { kind: 'remove'; path: string };

/** Files that a release writes for the next command to read, as opposed to release content. */
const HANDOFF_FILES = new Set([RELEASE_SUMMARY_FILE, RELEASE_TAGS_FILE]);

/**
 * A release computed in full but not yet written.
 *
 * Because the plan contains every intended file up front, `prepare` can fail during computation
 * without leaving anything on disk. {@link applyReleasePlan} is the only step that mutates the
 * tree, so a dry run is this same plan with the apply step skipped.
 *
 * Extends the reporting view with the two fields that only the apply step reads.
 */
export interface ReleasePlan extends PrepareResult {
  writes: readonly PlannedWrite[];
  /** Files that the release removes, such as changelog archive files that the render no longer produces. */
  removals: readonly string[];
  /** Body of the release commit message, written alongside the tags file. */
  summary: string;
}

/**
 * Applies every step that a plan describes: content files first, then removals, then the summary, then the tags file.
 *
 * The tags file goes last so that its presence means that the whole plan was written to disk.
 * Both `release-kit commit` and the reusable release workflow read it as the signal that a
 * release is ready to commit, so writing it earlier would let a failure produce a tree that
 * looks releasable.
 *
 * Returns the paths written or removed, in order. Throws if any step fails, naming what was applied and what was not.
 */
export function applyReleasePlan(plan: ReleasePlan): string[] {
  const ordered = orderPlannedSteps(plan);
  const applied: AppliedWrite[] = [];

  for (const [index, step] of ordered.entries()) {
    const outcome = applyStep(step);

    if (outcome.outcome === 'failed') {
      const unwritten = ordered.slice(index).map((pending) => pending.path);
      throw new Error(describeApplyFailure({ failedStep: step, error: outcome.error, applied, unwritten }));
    }

    applied.push({ path: step.path, created: outcome.outcome === 'created' });
  }

  return applied.map((write) => write.path);
}

/** Writes or removes one file, reporting whether it failed and, for a write, whether it created the file. */
function applyStep(step: PlannedStep): { outcome: 'applied' | 'created' | 'failed'; error?: string } {
  if (step.kind === 'remove') {
    try {
      deleteFileIfExists(step.path);
      return { outcome: 'applied' };
    } catch (error: unknown) {
      return { outcome: 'failed', error: describeError(error) };
    }
  }
  const result = writeFileWithCheck(step.path, step.content, { isDryRun: false, shouldOverwrite: true });
  if (result.outcome === 'failed') {
    return { outcome: 'failed', ...(result.error !== undefined && { error: result.error }) };
  }
  return { outcome: result.outcome === 'created' ? 'created' : 'applied' };
}

/** Orders a plan's steps for application: content writes, removals, then the summary and tags files in that order. */
function orderPlannedSteps(plan: ReleasePlan): PlannedStep[] {
  const ordered: PlannedStep[] = [
    ...plan.writes.map((write): PlannedStep => ({ kind: 'write', ...write })),
    ...plan.removals.map((path): PlannedStep => ({ kind: 'remove', path })),
  ];

  if (plan.summary.length > 0) {
    ordered.push({ kind: 'write', path: RELEASE_SUMMARY_FILE, content: plan.summary });
  }
  if (plan.tags.length > 0) {
    ordered.push({ kind: 'write', path: RELEASE_TAGS_FILE, content: plan.tags.join('\n') });
  }

  return ordered;
}

/** Inputs to {@link describeApplyFailure}. */
interface DescribeApplyFailureArgs {
  failedStep: PlannedStep;
  error: string | undefined;
  applied: readonly AppliedWrite[];
  unwritten: readonly string[];
}

/**
 * Composes the failure message for a partially applied plan.
 *
 * Names both sides of the boundary and how to undo the written side. A tree left midway through
 * a release looks like an ordinary set of edits, so the operator cannot tell the two apart
 * without being told which files the run touched.
 */
function describeApplyFailure(args: DescribeApplyFailureArgs): string {
  const { failedStep, error, applied, unwritten } = args;
  const total = applied.length + unwritten.length;
  const verb = failedStep.kind === 'remove' ? 'remove' : 'write';
  const lines = [`Failed to ${verb} ${failedStep.path}: ${error ?? 'unknown error'}`, ''];

  if (applied.length === 0) {
    lines.push(`The release was not applied. None of its ${total} files were written.`);
    return lines.join('\n');
  }

  lines.push(
    `The release was partially applied. ${applied.length} of ${total} files were written:`,
    ...applied.map((write) => `  ${write.path}`),
    '',
    'Not written:',
    ...unwritten.map((path) => `  ${path}`),
    ...describeRecovery(applied),
  );

  return lines.join('\n');
}

/**
 * Renders the commands that undo a partial apply, one per kind of write.
 *
 * A replaced file is restored from git; a created file is deleted, since git does not have an
 * entry from which to restore it and a single `git restore` over both fails on the unmatched
 * pathspec. The handoff files are left out: `prepare` overwrites them on its next run, and they
 * are in a conventionally ignored directory, on which `git restore` would fail too.
 */
function describeRecovery(applied: readonly AppliedWrite[]): string[] {
  const releaseWrites = applied.filter((write) => !HANDOFF_FILES.has(write.path));
  const replaced = releaseWrites.filter((write) => !write.created).map((write) => write.path);
  const created = releaseWrites.filter((write) => write.created).map((write) => write.path);

  if (replaced.length === 0 && created.length === 0) {
    return [];
  }

  const lines = ['', 'Undo the written release files before re-running `release-kit prepare`:'];
  if (replaced.length > 0) {
    lines.push(`  git restore ${replaced.join(' ')}`);
  }
  if (created.length > 0) {
    lines.push(`  rm ${created.join(' ')}`);
  }

  return lines;
}
