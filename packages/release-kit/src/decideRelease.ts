import { determineBumpType } from './determineBumpType.ts';
import { parseCommitMessage, type PolicyViolationHandler } from './parseCommitMessage.ts';
import type { Commit, ParsedCommit, ReleaseType, VersionPatterns, WorkTypeConfig } from './types.ts';

/** Inputs to the unified release decision used by both pipelines. */
export interface DecideReleaseArgs {
  commits: readonly Commit[];
  /** True when `--force` was passed; treats absence of a natural bump as patch. Defaults to false. */
  force?: boolean | undefined;
  /** Explicit `--bump=X` override. When set, the level is X regardless of the natural bump. */
  bumpOverride: ReleaseType | undefined;
  workTypes: Record<string, WorkTypeConfig>;
  versionPatterns: VersionPatterns;
  scopeAliases: Record<string, string> | undefined;
  /** Per-canonical-type breaking-policy lookup. When provided, drives `!` policy enforcement in `parseCommitMessage`. */
  breakingPolicies?: Record<string, 'forbidden' | 'optional' | 'required'>;
  /** Receives policy-violation notifications from `parseCommitMessage`. */
  onPolicyViolation?: PolicyViolationHandler;
  /**
   * Skip wordings to use when no commits exist (`noCommits`) or when commits exist but
   * none parse to a bump-worthy work type (`noBumpWorthy`). Both pipelines pass their
   * own pre-rendered wordings (with `{name}` / `since` substitutions already applied).
   */
  skipReasons: {
    noCommits: string;
    noBumpWorthy: string;
  };
}

/** Outcome of `decideRelease`: either release at a chosen level or skip with a reason. */
export type DecideReleaseResult =
  | {
      outcome: 'release';
      releaseType: ReleaseType;
      parsedCommitCount: number;
      unparseableCommits: Commit[] | undefined;
    }
  | {
      outcome: 'skip';
      skipReason: string;
      parsedCommitCount: number;
      unparseableCommits: Commit[] | undefined;
    };

/**
 * Apply the unified release-decision algorithm shared by both `releasePrepareProject`
 * and the per-workspace path in `releasePrepareMono`.
 *
 * Algorithm:
 *   shouldRelease = naturalBump !== undefined OR force === true
 *   releaseLevel  = bumpOverride ?? naturalBump ?? 'patch'
 *
 * "natural bump" is the raw output of `determineBumpType` over the parsed commits — it
 * is `undefined` when no commits exist or when none of the parsed commits map to a
 * bump-worthy work type. Note that this differs from `determineBumpFromCommits`, which
 * applies a patch floor whenever any commits exist; the patch floor is intentionally
 * not applied here so that `--bump=X` and `--force` remain orthogonal (the floor is
 * applied only when `--force` is set, by virtue of the `naturalBump ?? 'patch'`
 * fallback in the release-level expression above).
 *
 * `parsedCommitCount` and `unparseableCommits` are returned in both branches so callers
 * can surface diagnostic data uniformly regardless of skip/release outcome.
 *
 * Scope: this is the canonical algorithm for the orthogonal-flag model in the
 * monorepo path (`releasePrepareProject` + per-workspace `determineDirectBumps`). The
 * single-package executor (`releasePrepare`) deliberately retains
 * `determineBumpFromCommits` and the legacy patch-floor semantics; `prepareCommand`
 * rejects `--force` without `--bump` in single-package mode to surface that gap. A
 * future ticket can unify the single-package path; see #313's external plan.
 */
export function decideRelease(args: DecideReleaseArgs): DecideReleaseResult {
  const {
    commits,
    force = false,
    bumpOverride,
    workTypes,
    versionPatterns,
    scopeAliases,
    breakingPolicies,
    onPolicyViolation,
    skipReasons,
  } = args;

  const parseOptions =
    breakingPolicies !== undefined || onPolicyViolation !== undefined
      ? {
          ...(breakingPolicies !== undefined && { breakingPolicies }),
          ...(onPolicyViolation !== undefined && { onPolicyViolation }),
        }
      : undefined;

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

  const parsedCommitCount = parsedCommits.length;
  const unparseableCommits = unparseable.length > 0 ? unparseable : undefined;

  // Natural bump: the bump derived from parsing, with NO patch floor applied. Undefined
  // when no parsed commit maps to a bump-worthy work type (or when there are no commits).
  const naturalBump = determineBumpType(parsedCommits, workTypes, versionPatterns);

  const shouldRelease = naturalBump !== undefined || force;

  if (!shouldRelease) {
    const skipReason = commits.length === 0 ? skipReasons.noCommits : skipReasons.noBumpWorthy;
    return { outcome: 'skip', skipReason, parsedCommitCount, unparseableCommits };
  }

  const releaseType: ReleaseType = bumpOverride ?? naturalBump ?? 'patch';
  return { outcome: 'release', releaseType, parsedCommitCount, unparseableCommits };
}
