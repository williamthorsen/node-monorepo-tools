import { describe, expect, it } from 'vitest';

import { decideRelease, type DecideReleaseResult } from '../decideRelease.ts';
import type { ReleaseType } from '../types.ts';

const skipReasons = {
  noCommits: 'No commits since v1.0.0. Pass --force to release at patch. Skipping.',
  noBumpWorthy:
    'No bump-worthy commits since v1.0.0. Pass --force to release at patch (or --force --bump=X for a different level). Skipping.',
};

const SKIP_NO_COMMITS: DecideReleaseResult = { outcome: 'skip', skipReason: skipReasons.noCommits };
const SKIP_NO_BUMP_WORTHY: DecideReleaseResult = { outcome: 'skip', skipReason: skipReasons.noBumpWorthy };

describe(decideRelease, () => {
  it.each<[string, Row, DecideReleaseResult]>([
    ['no commits, no flags', { commitCount: 0 }, SKIP_NO_COMMITS],
    ['no commits, --bump alone', { commitCount: 0, bumpOverride: 'minor' }, SKIP_NO_COMMITS],
    ['no commits, --force alone', { commitCount: 0, force: true }, release('patch')],
    ['no commits, --force --bump', { commitCount: 0, force: true, bumpOverride: 'major' }, release('major')],
    ['commits without a bump, no flags', { commitCount: 2 }, SKIP_NO_BUMP_WORTHY],
    ['commits without a bump, --bump alone', { commitCount: 2, bumpOverride: 'minor' }, SKIP_NO_BUMP_WORTHY],
    ['commits without a bump, --force alone', { commitCount: 2, force: true }, release('patch')],
    [
      'commits without a bump, --force --bump',
      { commitCount: 2, force: true, bumpOverride: 'minor' },
      release('minor'),
    ],
    ['a natural bump, no flags', { commitCount: 1, naturalBump: 'minor' }, release('minor')],
    ['a natural bump, --bump', { commitCount: 1, naturalBump: 'minor', bumpOverride: 'patch' }, release('patch')],
    ['a natural bump, --force', { commitCount: 1, naturalBump: 'major', force: true }, release('major')],
  ])('decides %s', (_label, row, expected) => {
    const result = decideRelease({
      naturalBump: row.naturalBump,
      commitCount: row.commitCount,
      force: row.force,
      bumpOverride: row.bumpOverride,
      skipReasons,
    });

    expect(result).toStrictEqual(expected);
  });
});

// region | Helpers

/** One row of the decision table. */
interface Row {
  naturalBump?: ReleaseType;
  commitCount: number;
  force?: boolean;
  bumpOverride?: ReleaseType;
}

/** Builds the release outcome at a level. */
function release(releaseType: ReleaseType): DecideReleaseResult {
  return { outcome: 'release', releaseType };
}

// endregion | Helpers
