import {
  COMMIT_PREPROCESSOR_PATTERNS,
  parseCommitMessage,
  type ParseCommitMessageOptions,
} from './parseCommitMessage.ts';
import type { Commit, WorkTypeConfig } from './types.ts';

/** Matches the subject of a release commit, which records version bumps rather than a change to report. */
const RELEASE_SUBJECT_PATTERN = /^release:/;

/** Matches the subject git writes for a merge commit, whose content the merged commits already report. */
const MERGE_SUBJECT_PATTERN = /^Merge/;

/**
 * How a commit's title places it in a changelog: under a section header, excluded by design, or unreadable.
 *
 * `breaking` is the parser's flag under the breaking policies passed in, which a `BREAKING CHANGE:` footer can set.
 */
export type ChangelogClassification =
  { kind: 'header'; header: string; type: string; breaking: boolean } | { kind: 'excluded' } | { kind: 'unparseable' };

/**
 * Classifies a commit by its title.
 *
 * Four gates decide, in order: a `release:` or `Merge` subject is excluded; a subject carrying no ticket-ID prefix is
 * unparseable; a type that `parseCommitMessage` cannot resolve against `workTypes` is unparseable; and a type that
 * `workTypes` excludes from the changelog is excluded. A commit that passes all four takes the header its type declares.
 *
 * `options` reaches the parse, so a policy violation is reported for every ticketed commit whose type resolves,
 * excluded types included.
 *
 * The header carries no order encoding. `buildChangelogEntries` sorts sections by canonical priority, so
 * the position a section occupies comes from the taxonomy rather than from the header string.
 */
export function classifyChangelogCommit(
  commit: Pick<Commit, 'hash' | 'message'>,
  workTypes: Record<string, WorkTypeConfig>,
  options?: ParseCommitMessageOptions,
): ChangelogClassification {
  const subject = commit.message.split('\n', 1)[0] ?? '';

  if (isNonChangeSubject(subject)) {
    return { kind: 'excluded' };
  }

  if (!hasTicketPrefix(subject)) {
    return { kind: 'unparseable' };
  }

  const parsed = parseCommitMessage(commit.message, commit.hash, workTypes, undefined, options);
  if (parsed === undefined) {
    return { kind: 'unparseable' };
  }

  const config = workTypes[parsed.type];
  if (config === undefined) {
    return { kind: 'unparseable' };
  }
  if (config.excludedFromChangelog === true) {
    return { kind: 'excluded' };
  }

  return { kind: 'header', header: config.header, type: parsed.type, breaking: parsed.breaking };
}

/**
 * Reports whether a subject belongs to a commit that never reaches a changelog: a `release:` commit, which records
 * version bumps, or a git merge commit, whose content the merged commits already report.
 */
export function isNonChangeSubject(subject: string): boolean {
  return isReleaseSubject(subject) || MERGE_SUBJECT_PATTERN.test(subject);
}

/** Reports whether a subject belongs to a `release:` commit, which records version bumps rather than a change. */
export function isReleaseSubject(subject: string): boolean {
  return RELEASE_SUBJECT_PATTERN.test(subject);
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
