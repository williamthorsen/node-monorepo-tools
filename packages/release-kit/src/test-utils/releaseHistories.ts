import type { ChangelogDiagnostics, ReleaseHistory } from '../buildChangelogEntries.ts';
import type { RawCommit } from '../enumerateReleaseWindows.ts';
import type { ChangelogEntry, ChangelogSection, ReleaseType } from '../types.ts';
import { type CommitStub, makeStubbedCommits } from './commitStubs.ts';

/** The parts of a history that a test states; every other part defaults to empty. */
export interface ReleaseHistoryStub {
  previousTag?: string | undefined;
  commits?: readonly CommitStub[];
  bump?: ReleaseType | undefined;
  /** Defaults to the number of commits when `bump` is set, and to 0 otherwise. */
  parsedCommitCount?: number;
  unparseableCommits?: readonly CommitStub[];
  sections?: ChangelogSection[];
  releasedEntries?: ChangelogEntry[];
  diagnostics?: Partial<ChangelogDiagnostics>;
}

/** Builds a `readReleaseHistory` result, for a mocked reader to return. */
export function makeReleaseHistory(stub: ReleaseHistoryStub = {}): ReleaseHistory {
  const commits: RawCommit[] = makeStubbedCommits(stub.commits ?? []);
  return {
    previousTag: stub.previousTag,
    releasedEntries: stub.releasedEntries ?? [],
    unreleased: {
      bump: stub.bump,
      commits,
      date: '2024-01-01',
      diagnostics: {
        malformedBlocks: [],
        policyViolations: [],
        undeclaredEntryTypes: [],
        unroutedEntryScopes: [],
        ...stub.diagnostics,
      },
      parsedCommitCount: stub.parsedCommitCount ?? (stub.bump === undefined ? 0 : commits.length),
      sections: stub.sections ?? [],
      unparseableCommits:
        stub.unparseableCommits === undefined ? undefined : makeStubbedCommits(stub.unparseableCommits),
    },
  };
}
