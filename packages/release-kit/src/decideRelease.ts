import type { ReleaseType } from './types.ts';

/** Inputs to the release decision that every release path makes. */
export interface DecideReleaseArgs {
  /** The bump that the window's changelog items call for; undefined when they call for none. */
  naturalBump: ReleaseType | undefined;
  /** The number of commits in the window, which selects the skip reason. */
  commitCount: number;
  /** True when `--force` was passed; treats absence of a natural bump as patch. Defaults to false. */
  force?: boolean | undefined;
  /** Explicit `--bump=X` override. When set, the level is X regardless of the natural bump. */
  bumpOverride: ReleaseType | undefined;
  /**
   * Skip wordings to use when no commits exist (`noCommits`) or when commits exist but none yields a changelog item
   * (`noBumpWorthy`). Each path passes its own pre-rendered wordings.
   */
  skipReasons: {
    noCommits: string;
    noBumpWorthy: string;
  };
}

/** Outcome of `decideRelease`: either release at a chosen level or skip with a reason. */
export type DecideReleaseResult =
  { outcome: 'release'; releaseType: ReleaseType } | { outcome: 'skip'; skipReason: string };

/**
 * Decides whether a window releases, and at which level.
 *
 * Algorithm:
 *   shouldRelease = naturalBump !== undefined OR force === true
 *   releaseLevel  = bumpOverride ?? naturalBump ?? 'patch'
 *
 * No patch floor applies, so `--bump=X` chooses a level without triggering a release, and `--force` triggers one
 * without choosing a level.
 */
export function decideRelease(args: DecideReleaseArgs): DecideReleaseResult {
  const { naturalBump, commitCount, force = false, bumpOverride, skipReasons } = args;

  if (naturalBump === undefined && !force) {
    const skipReason = commitCount === 0 ? skipReasons.noCommits : skipReasons.noBumpWorthy;
    return { outcome: 'skip', skipReason };
  }

  return { outcome: 'release', releaseType: bumpOverride ?? naturalBump ?? 'patch' };
}
