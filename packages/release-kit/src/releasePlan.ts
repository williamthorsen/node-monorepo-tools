import { writeFileWithCheck } from '@williamthorsen/nmr-core';

import { RELEASE_SUMMARY_FILE, RELEASE_TAGS_FILE } from './releaseFiles.ts';
import type { PrepareResult } from './types.ts';

/** One file a release will write, carried as its complete intended content. */
export interface PlannedWrite {
  path: string;
  content: string;
}

/** A write that reached disk, and whether it created the file or replaced existing content. */
interface AppliedWrite {
  path: string;
  created: boolean;
}

/** Files a release writes for the next command to read, rather than release content. */
const HANDOFF_FILES = new Set([RELEASE_SUMMARY_FILE, RELEASE_TAGS_FILE]);

/**
 * A release computed in full but not yet written.
 *
 * Holding every intended file up front is what lets `prepare` fail during computation without
 * leaving anything on disk. {@link applyReleasePlan} is the only step that mutates the tree, so
 * a dry run is this same plan with the apply step skipped rather than a separate code path.
 *
 * Extends the reporting view with the two fields only the apply step needs, so `reportPrepare`
 * can render a plan without knowing about file content.
 */
export interface ReleasePlan extends PrepareResult {
  writes: readonly PlannedWrite[];
  /** Body of the release commit message, written alongside the tags file. */
  summary: string;
}

/**
 * Writes every file a plan describes: content files first, then the summary, then the tags file.
 *
 * The tags file goes last so its presence means the whole plan landed. Both `release-kit commit`
 * and the reusable release workflow read it as the signal that a release is ready to commit, so
 * writing it earlier would let a failure produce a tree that claims to be releasable.
 *
 * Returns the paths written, in order.
 *
 * @throws If any write fails, naming what reached disk and what did not.
 */
export function applyReleasePlan(plan: ReleasePlan): string[] {
  const ordered = orderPlannedWrites(plan);
  const applied: AppliedWrite[] = [];

  for (const [index, write] of ordered.entries()) {
    const result = writeFileWithCheck(write.path, write.content, { dryRun: false, overwrite: true });

    if (result.outcome === 'failed') {
      const unwritten = ordered.slice(index).map((pending) => pending.path);
      throw new Error(describeApplyFailure({ failedPath: write.path, error: result.error, applied, unwritten }));
    }

    applied.push({ path: write.path, created: result.outcome === 'created' });
  }

  return applied.map((write) => write.path);
}

/** Orders a plan's writes for application, appending the summary and tags files in that order. */
function orderPlannedWrites(plan: ReleasePlan): PlannedWrite[] {
  const ordered = [...plan.writes];

  if (plan.summary.length > 0) {
    ordered.push({ path: RELEASE_SUMMARY_FILE, content: plan.summary });
  }
  if (plan.tags.length > 0) {
    ordered.push({ path: RELEASE_TAGS_FILE, content: plan.tags.join('\n') });
  }

  return ordered;
}

/** Inputs to {@link describeApplyFailure}. */
interface DescribeApplyFailureArgs {
  failedPath: string;
  error: string | undefined;
  applied: readonly AppliedWrite[];
  unwritten: readonly string[];
}

/**
 * Composes the failure message for a partially applied plan.
 *
 * Names both sides of the boundary and how to undo the written side. A tree left midway through
 * a release looks like an ordinary set of edits, so the operator has no way to tell the two apart
 * without being told which files the run touched.
 */
function describeApplyFailure(args: DescribeApplyFailureArgs): string {
  const { failedPath, error, applied, unwritten } = args;
  const total = applied.length + unwritten.length;
  const lines = [`Failed to write ${failedPath}: ${error ?? 'unknown error'}`, ''];

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
 * A replaced file is restored from git; a created file is deleted, since git has no entry to
 * restore it from and a single `git restore` over both fails on the unmatched pathspec. The
 * handoff files are left out: `prepare` overwrites them on its next run, and they sit under a
 * conventionally ignored directory where `git restore` would fail on them too.
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
