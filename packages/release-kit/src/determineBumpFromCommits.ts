import { determineBumpType } from './determineBumpType.ts';
import {
  parseCommitMessage,
  type ParseCommitMessageOptions,
  type PolicyViolationHandler,
} from './parseCommitMessage.ts';
import type { Commit, ParsedCommit, ReleaseType, VersionPatterns, WorkTypeConfig } from './types.ts';

/** Aggregate result of parsing commits and determining the bump type. */
export interface BumpDetermination {
  releaseType: ReleaseType | undefined;
  parsedCommitCount: number;
  unparseableCommits: Commit[] | undefined;
}

/** Optional configuration for parser-policy plumbing. */
export interface DetermineBumpOptions {
  /** Per-canonical-type breaking-policy lookup (drives `!` policy enforcement). */
  breakingPolicies?: Record<string, 'forbidden' | 'optional' | 'required'>;
  /** Receives policy-violation notifications from `parseCommitMessage`. */
  onPolicyViolation?: PolicyViolationHandler;
}

/** Parse commits, determine bump type, and apply patch floor when commits exist but none parsed. */
export function determineBumpFromCommits(
  commits: Commit[],
  workTypes: Record<string, WorkTypeConfig>,
  versionPatterns: VersionPatterns,
  scopeAliases: Record<string, string> | undefined,
  options?: DetermineBumpOptions,
): BumpDetermination {
  // Build with conditional spreads so absent fields stay absent (required by
  // `exactOptionalPropertyTypes: true`); passing an empty `{}` to `parseCommitMessage` is
  // functionally identical to passing `undefined`, so no outer guard is needed.
  const parseOptions: ParseCommitMessageOptions = {
    ...(options?.breakingPolicies !== undefined && { breakingPolicies: options.breakingPolicies }),
    ...(options?.onPolicyViolation !== undefined && { onPolicyViolation: options.onPolicyViolation }),
  };

  const parsedCommits: ParsedCommit[] = [];
  const unparseable: Commit[] = [];

  for (const commit of commits) {
    const parsed = parseCommitMessage(commit.message, commit.hash, workTypes, scopeAliases, parseOptions);
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
