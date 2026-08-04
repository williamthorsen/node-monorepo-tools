import { writeFileWithCheck } from '@williamthorsen/nmr-core';

import { RELEASE_SUMMARY_FILE, RELEASE_TAGS_FILE } from './releaseFiles.ts';
import type { ProjectPrepareResult, WorkspacePrepareResult } from './types.ts';

/** One file a release will write, carried as its complete intended content. */
export interface PlannedWrite {
  path: string;
  content: string;
}

/** The format command a release runs once its files are on disk, rendered but not executed. */
export interface FormatCommandPlan {
  command: string;
  files: string[];
}

/**
 * A release computed in full but not yet written.
 *
 * Holding every intended file up front is what lets `prepare` fail during computation without
 * leaving anything on disk. {@link applyReleasePlan} is the only step that mutates the tree, so
 * a dry run is this same plan with the apply step skipped rather than a separate code path.
 */
export interface ReleasePlan {
  writes: readonly PlannedWrite[];
  tags: readonly string[];
  summary: string;
  formatCommand: FormatCommandPlan | undefined;
  workspaces: WorkspacePrepareResult[];
  project?: ProjectPrepareResult;
  warnings?: string[];
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
  const written: string[] = [];

  for (const [index, write] of ordered.entries()) {
    const result = writeFileWithCheck(write.path, write.content, { dryRun: false, overwrite: true });

    if (result.outcome === 'failed') {
      const unwritten = ordered.slice(index).map((pending) => pending.path);
      throw new Error(describeApplyFailure(write.path, result.error, written, unwritten));
    }

    written.push(write.path);
  }

  return written;
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

/**
 * Composes the failure message for a partially applied plan.
 *
 * Names both sides of the boundary and the command that reverts the written side. A tree left
 * midway through a release looks like an ordinary set of edits, so the operator has no way to
 * tell the two apart without being told which files the run touched.
 */
function describeApplyFailure(
  failedPath: string,
  error: string | undefined,
  written: readonly string[],
  unwritten: readonly string[],
): string {
  const total = written.length + unwritten.length;
  const lines = [`Failed to write ${failedPath}: ${error ?? 'unknown error'}`, ''];

  if (written.length === 0) {
    lines.push(`The release was not applied. None of its ${total} files were written.`);
    return lines.join('\n');
  }

  lines.push(
    `The release was partially applied. ${written.length} of ${total} files were written:`,
    ...written.map((path) => `  ${path}`),
    '',
    'Not written:',
    ...unwritten.map((path) => `  ${path}`),
    '',
    'Revert the written files before re-running `release-kit prepare`:',
    `  git restore ${written.join(' ')}`,
  );

  return lines.join('\n');
}
