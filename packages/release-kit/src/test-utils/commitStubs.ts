import type { RawCommit } from '../enumerateReleaseWindows.ts';

/** A commit a test describes by its subject and hash alone. */
export type CommitStub = readonly [subject: string, hash: string];

/**
 * Builds raw commits from subject-and-hash pairs, for a stubbed commit reader to return.
 *
 * A test using it asserts on subjects, hashes, and the decisions drawn from them, none of which
 * a body affects, so each stub carries an empty body and a message equal to its subject.
 */
export function makeStubbedCommits(entries: readonly CommitStub[]): RawCommit[] {
  return entries.map(([subject, hash]) => ({ hash, subject, body: '', message: subject }));
}
