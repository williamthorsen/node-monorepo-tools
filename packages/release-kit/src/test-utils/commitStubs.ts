import type { RawCommit } from '../enumerateReleaseWindows.ts';

/** A commit a test describes by its subject and hash alone. */
export type CommitStub = readonly [subject: string, hash: string];

/**
 * Builds the commits a `getCommitsSinceTarget` stub returns from subject-and-hash pairs.
 *
 * A release-prepare test asserts on subjects, hashes, and bump decisions, none of which a
 * body affects, so each stub carries an empty body and a message equal to its subject.
 */
export function makeStubbedCommits(entries: readonly CommitStub[]): RawCommit[] {
  return entries.map(([subject, hash]) => ({ hash, subject, body: '', message: subject }));
}
