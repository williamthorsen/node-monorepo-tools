import { determineBumpType } from './determineBumpType.ts';
import { parseCommitMessage } from './parseCommitMessage.ts';
import type { Commit, ParsedCommit, ReleaseType, VersionPatterns, WorkTypeConfig } from './types.ts';

/** Aggregate result of parsing commits and determining the bump type. */
export interface BumpDetermination {
  releaseType: ReleaseType | undefined;
  parsedCommitCount: number;
  unparseableCommits: Commit[] | undefined;
}

/** Parse commits, determine bump type, and apply patch floor when commits exist but none parsed. */
export function determineBumpFromCommits(
  commits: Commit[],
  workTypes: Record<string, WorkTypeConfig>,
  versionPatterns: VersionPatterns,
  workspaceAliases: Record<string, string> | undefined,
): BumpDetermination {
  const parsedCommits: ParsedCommit[] = [];
  const unparseable: Commit[] = [];

  for (const commit of commits) {
    const parsed = parseCommitMessage(commit.message, commit.hash, workTypes, workspaceAliases);
    if (parsed === undefined) {
      unparseable.push(commit);
    } else {
      parsedCommits.push(parsed);
    }
  }

  let releaseType = determineBumpType(parsedCommits, workTypes, versionPatterns);

  // Apply patch floor: commits exist but none determined a bump type
  if (releaseType === undefined && commits.length > 0) {
    releaseType = 'patch';
  }

  return {
    releaseType,
    parsedCommitCount: parsedCommits.length,
    unparseableCommits: unparseable.length > 0 ? unparseable : undefined,
  };
}
