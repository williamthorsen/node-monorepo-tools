import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { hasErrnoCode } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

/**
 * File written by the release preparation step, containing one tag per line.
 *
 * Relative to the project root so that it works identically in CI and local runs. The reusable
 * release workflow reads it at this path, so the path and the line-delimited format are a
 * published contract.
 */
export const RELEASE_TAGS_FILE = 'tmp/.release-tags';

/**
 * File written by the release preparation step, containing the commit body summary.
 * Relative to the project root so that it works identically in CI and local runs.
 */
export const RELEASE_SUMMARY_FILE = 'tmp/.release-summary';

/** Resolves the tags file against the current working directory, for use in diagnostics. */
export function resolveReleaseTagsPath(): string {
  return resolve(RELEASE_TAGS_FILE);
}

/**
 * Reads the tag names written by `prepare`, one per line, discarding blank lines.
 *
 * A failure message names the path as resolved against `process.cwd()`, which distinguishes an
 * absent file from one that the command looked for under a different worktree.
 *
 * An empty or blank file yields an empty array; callers decide whether that is an error.
 */
export function readReleaseTags(): string[] {
  let content: string;
  try {
    content = readFileSync(RELEASE_TAGS_FILE, 'utf8');
  } catch (error: unknown) {
    throw new Error(describeTagsReadFailure(error), { cause: error });
  }

  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Composes the failure message for an unreadable tags file.
 *
 * `ENOENT` is the only code that means that `prepare` has not produced a release, so only its
 * message tells the operator to run `prepare`. Every other code (`EACCES`, `EISDIR`, and the
 * rest) describes a file that exists but could not be read, and its message includes the
 * underlying error.
 */
function describeTagsReadFailure(error: unknown): string {
  const tagsPath = resolveReleaseTagsPath();

  if (hasErrnoCode(error, 'ENOENT')) {
    return `No tags file found at ${tagsPath}. Run \`release-kit prepare\` first.`;
  }

  const detail = describeError(error);
  return `Cannot read the tags file at ${tagsPath}: ${detail}`;
}
