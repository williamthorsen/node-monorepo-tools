import { describe, expect, it } from 'vitest';

import { decideRelease } from '../decideRelease.ts';
import { DEFAULT_VERSION_PATTERNS } from '../defaults.ts';
import type { Commit, VersionPatterns, WorkTypeConfig } from '../types.ts';

const workTypes: Record<string, WorkTypeConfig> = {
  feat: { header: 'Features' },
  fix: { header: 'Bug fixes' },
};

const versionPatterns: VersionPatterns = DEFAULT_VERSION_PATTERNS;

const skipReasons = {
  noCommits: 'No commits since v1.0.0. Pass --force to release at patch. Skipping.',
  noBumpWorthy:
    'No bump-worthy commits since v1.0.0. Pass --force to release at patch (or --force --bump=X for a different level). Skipping.',
};

function makeCommit(message: string, hash = 'abc1234'): Commit {
  return { message, hash };
}

describe(decideRelease, () => {
  describe('row 1: no commits, no flags', () => {
    it('skips with the no-commits reason', () => {
      const result = decideRelease({
        commits: [],
        force: false,
        bumpOverride: undefined,
        workTypes,
        versionPatterns,
        scopeAliases: undefined,
        skipReasons,
      });

      expect(result.outcome).toBe('skip');
      if (result.outcome === 'skip') {
        expect(result.skipReason).toBe(skipReasons.noCommits);
      }
    });
  });

  describe('row 2: no commits, --bump=X alone', () => {
    it('skips with the no-commits reason regardless of bumpOverride', () => {
      const result = decideRelease({
        commits: [],
        force: false,
        bumpOverride: 'minor',
        workTypes,
        versionPatterns,
        scopeAliases: undefined,
        skipReasons,
      });

      expect(result.outcome).toBe('skip');
      if (result.outcome === 'skip') {
        expect(result.skipReason).toBe(skipReasons.noCommits);
      }
    });
  });

  describe('row 3: no commits, --force alone', () => {
    it('releases at patch (force fallback)', () => {
      const result = decideRelease({
        commits: [],
        force: true,
        bumpOverride: undefined,
        workTypes,
        versionPatterns,
        scopeAliases: undefined,
        skipReasons,
      });

      expect(result.outcome).toBe('release');
      if (result.outcome === 'release') {
        expect(result.releaseType).toBe('patch');
      }
    });
  });

  describe('row 4: no commits, --force --bump=X', () => {
    it('releases at the chosen level', () => {
      const result = decideRelease({
        commits: [],
        force: true,
        bumpOverride: 'minor',
        workTypes,
        versionPatterns,
        scopeAliases: undefined,
        skipReasons,
      });

      expect(result.outcome).toBe('release');
      if (result.outcome === 'release') {
        expect(result.releaseType).toBe('minor');
      }
    });
  });

  describe('row 5: natural bump exists, no flags', () => {
    it('releases at the natural bump level', () => {
      const result = decideRelease({
        commits: [makeCommit('feat: add thing')],
        force: false,
        bumpOverride: undefined,
        workTypes,
        versionPatterns,
        scopeAliases: undefined,
        skipReasons,
      });

      expect(result.outcome).toBe('release');
      if (result.outcome === 'release') {
        expect(result.releaseType).toBe('minor');
        expect(result.parsedCommitCount).toBe(1);
      }
    });
  });

  describe('row 6: natural bump exists, --bump=X overrides', () => {
    it('releases at the chosen level (override beats natural)', () => {
      const result = decideRelease({
        commits: [makeCommit('feat: add thing')], // natural would be minor
        force: false,
        bumpOverride: 'patch',
        workTypes,
        versionPatterns,
        scopeAliases: undefined,
        skipReasons,
      });

      expect(result.outcome).toBe('release');
      if (result.outcome === 'release') {
        expect(result.releaseType).toBe('patch');
      }
    });
  });

  describe('row 7: natural bump exists, --force is a no-op', () => {
    it('releases at the natural bump level when force is set without bumpOverride', () => {
      const result = decideRelease({
        commits: [makeCommit('feat: add thing')],
        force: true,
        bumpOverride: undefined,
        workTypes,
        versionPatterns,
        scopeAliases: undefined,
        skipReasons,
      });

      expect(result.outcome).toBe('release');
      if (result.outcome === 'release') {
        expect(result.releaseType).toBe('minor');
      }
    });
  });

  describe('row 9: commits exist but none bump-worthy, no flags', () => {
    it('skips with the no-bump-worthy reason', () => {
      // 'chore' is not in workTypes (only feat, fix), so the commit is unparseable
      // and naturalBump is undefined.
      const result = decideRelease({
        commits: [makeCommit('chore: deps')],
        force: false,
        bumpOverride: undefined,
        workTypes,
        versionPatterns,
        scopeAliases: undefined,
        skipReasons,
      });

      expect(result.outcome).toBe('skip');
      if (result.outcome === 'skip') {
        expect(result.skipReason).toBe(skipReasons.noBumpWorthy);
        expect(result.parsedCommitCount).toBe(0);
        expect(result.unparseableCommits).toStrictEqual([{ message: 'chore: deps', hash: 'abc1234' }]);
      }
    });
  });

  describe('row 10: commits exist but none bump-worthy, --bump=X alone', () => {
    it('skips with the no-bump-worthy reason (bumpOverride is a chooser, not a trigger)', () => {
      const result = decideRelease({
        commits: [makeCommit('chore: deps')],
        force: false,
        bumpOverride: 'minor',
        workTypes,
        versionPatterns,
        scopeAliases: undefined,
        skipReasons,
      });

      expect(result.outcome).toBe('skip');
      if (result.outcome === 'skip') {
        expect(result.skipReason).toBe(skipReasons.noBumpWorthy);
      }
    });
  });

  describe('row 11: commits exist but none bump-worthy, --force alone', () => {
    it('releases at patch (force fallback)', () => {
      const result = decideRelease({
        commits: [makeCommit('chore: deps')],
        force: true,
        bumpOverride: undefined,
        workTypes,
        versionPatterns,
        scopeAliases: undefined,
        skipReasons,
      });

      expect(result.outcome).toBe('release');
      if (result.outcome === 'release') {
        expect(result.releaseType).toBe('patch');
        expect(result.parsedCommitCount).toBe(0);
      }
    });
  });

  describe('row 12: commits exist but none bump-worthy, --force --bump=X', () => {
    it('releases at the chosen level', () => {
      const result = decideRelease({
        commits: [makeCommit('chore: deps')],
        force: true,
        bumpOverride: 'major',
        workTypes,
        versionPatterns,
        scopeAliases: undefined,
        skipReasons,
      });

      expect(result.outcome).toBe('release');
      if (result.outcome === 'release') {
        expect(result.releaseType).toBe('major');
      }
    });
  });

  describe('diagnostic data parity', () => {
    it('returns parsedCommitCount and unparseableCommits on a release outcome with mixed parseable/unparseable commits', () => {
      const result = decideRelease({
        commits: [makeCommit('feat: add thing'), makeCommit('chore: deps', 'def4567')],
        force: false,
        bumpOverride: undefined,
        workTypes,
        versionPatterns,
        scopeAliases: undefined,
        skipReasons,
      });

      expect(result.outcome).toBe('release');
      expect(result.parsedCommitCount).toBe(1);
      expect(result.unparseableCommits).toStrictEqual([{ message: 'chore: deps', hash: 'def4567' }]);
    });

    it('returns parsedCommitCount and unparseableCommits on a skip outcome with chore-only commits and no force', () => {
      const result = decideRelease({
        commits: [makeCommit('chore: deps', 'def4567'), makeCommit('chore: bump', 'ghi8901')],
        force: false,
        bumpOverride: undefined,
        workTypes,
        versionPatterns,
        scopeAliases: undefined,
        skipReasons,
      });

      expect(result.outcome).toBe('skip');
      expect(result.parsedCommitCount).toBe(0);
      expect(result.unparseableCommits).toStrictEqual([
        { message: 'chore: deps', hash: 'def4567' },
        { message: 'chore: bump', hash: 'ghi8901' },
      ]);
    });
  });
});
