import { COMMIT_PREPROCESSOR_PATTERNS, parseCommitMessage } from './parseCommitMessage.ts';
import type { WorkTypeConfig } from './types.ts';

/** Matches the subject of a release commit, which records version bumps rather than a change to report. */
const RELEASE_SUBJECT_PATTERN = /^release:/;

/** Matches the subject git writes for a merge commit, whose content the merged commits already report. */
const MERGE_SUBJECT_PATTERN = /^Merge/;

/**
 * Returns the changelog section header for a commit that belongs in a changelog, and `undefined` for one
 * that does not.
 *
 * Four gates decide, in order: a `release:` subject, a `Merge` subject, a subject carrying no ticket-ID
 * prefix, and a type that `parseCommitMessage` cannot resolve against `workTypes` or that `workTypes`
 * excludes from the changelog. A commit that passes all four takes the header its type declares.
 *
 * The header carries no order encoding. `buildChangelogEntries` sorts sections by canonical priority, so
 * the position a section occupies comes from the taxonomy rather than from the header string.
 */
export function classifyChangelogCommit(
  message: string,
  workTypes: Record<string, WorkTypeConfig>,
): string | undefined {
  const subject = message.split('\n', 1)[0] ?? '';

  if (isNonChangeSubject(subject)) {
    return undefined;
  }

  if (!hasTicketPrefix(subject)) {
    return undefined;
  }

  const parsed = parseCommitMessage(message, '', workTypes);
  if (parsed === undefined) {
    return undefined;
  }

  const config = workTypes[parsed.type];
  if (config === undefined || config.excludedFromChangelog === true) {
    return undefined;
  }

  return config.header;
}

/**
 * Reports whether a subject belongs to a commit that never reaches a changelog: a `release:` commit, which records
 * version bumps, or a git merge commit, whose content the merged commits already report.
 */
export function isNonChangeSubject(subject: string): boolean {
  return RELEASE_SUBJECT_PATTERN.test(subject) || MERGE_SUBJECT_PATTERN.test(subject);
}

// region | Helpers

/**
 * Reports whether a commit subject opens with a ticket-ID prefix.
 *
 * Reuses the patterns `parseCommitMessage` strips, so the accepted ticket forms have one home: a subject
 * is ticketed when some pattern shortens it.
 */
function hasTicketPrefix(subject: string): boolean {
  return COMMIT_PREPROCESSOR_PATTERNS.some((pattern) => pattern.test(subject));
}

// endregion | Helpers
