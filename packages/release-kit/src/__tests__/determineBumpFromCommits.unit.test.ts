import { describe, expect, it } from 'vitest';

import { DEFAULT_VERSION_PATTERNS } from '../defaults.ts';
import { determineBumpFromCommits } from '../determineBumpFromCommits.ts';
import type { Commit, VersionPatterns, WorkTypeConfig } from '../types.ts';

const workTypes: Record<string, WorkTypeConfig> = {
  feat: { header: 'Features', aliases: ['feature'] },
  fix: { header: 'Bug fixes', aliases: ['bugfix'] },
  refactor: { header: 'Refactoring' },
};

const versionPatterns: VersionPatterns = DEFAULT_VERSION_PATTERNS;

function makeCommit(message: string, hash = 'abc1234'): Commit {
  return { message, hash };
}

describe(determineBumpFromCommits, () => {
  describe('standard bump determination', () => {
    it('returns minor for a feat commit', () => {
      const commits = [makeCommit('feat: add thing')];
      const result = determineBumpFromCommits(commits, workTypes, versionPatterns, undefined);

      expect(result.releaseType).toBe('minor');
      expect(result.parsedCommitCount).toBe(1);
      expect(result.unparseableCommits).toBeUndefined();
    });

    it('returns patch for a fix commit', () => {
      const commits = [makeCommit('fix: resolve bug')];
      const result = determineBumpFromCommits(commits, workTypes, versionPatterns, undefined);

      expect(result.releaseType).toBe('patch');
      expect(result.parsedCommitCount).toBe(1);
      expect(result.unparseableCommits).toBeUndefined();
    });

    it('returns the highest bump type across multiple commits', () => {
      const commits = [makeCommit('fix: resolve bug'), makeCommit('feat: add thing')];
      const result = determineBumpFromCommits(commits, workTypes, versionPatterns, undefined);

      expect(result.releaseType).toBe('minor');
      expect(result.parsedCommitCount).toBe(2);
    });
  });

  describe('patch floor', () => {
    it('applies patch floor when all commits are unparseable', () => {
      const commits = [makeCommit('random noise', 'aaa1111'), makeCommit('also unparseable', 'bbb2222')];
      const result = determineBumpFromCommits(commits, workTypes, versionPatterns, undefined);

      expect(result.releaseType).toBe('patch');
      expect(result.parsedCommitCount).toBe(0);
      expect(result.unparseableCommits).toHaveLength(2);
      expect(result.unparseableCommits).toEqual([
        { message: 'random noise', hash: 'aaa1111' },
        { message: 'also unparseable', hash: 'bbb2222' },
      ]);
    });

    it('returns undefined releaseType for an empty commit list (no patch floor)', () => {
      const result = determineBumpFromCommits([], workTypes, versionPatterns, undefined);

      expect(result.releaseType).toBeUndefined();
      expect(result.parsedCommitCount).toBe(0);
      expect(result.unparseableCommits).toBeUndefined();
    });
  });

  describe('mixed parseable and unparseable commits', () => {
    it('uses the parsed bump type and tracks unparseable commits', () => {
      const commits = [makeCommit('feat: add feature', 'aaa1111'), makeCommit('not a conventional commit', 'bbb2222')];
      const result = determineBumpFromCommits(commits, workTypes, versionPatterns, undefined);

      expect(result.releaseType).toBe('minor');
      expect(result.parsedCommitCount).toBe(1);
      expect(result.unparseableCommits).toEqual([{ message: 'not a conventional commit', hash: 'bbb2222' }]);
    });

    it('returns patch when only fix commits parse alongside unparseable ones', () => {
      const commits = [makeCommit('fix: patch bug', 'aaa1111'), makeCommit('random message', 'bbb2222')];
      const result = determineBumpFromCommits(commits, workTypes, versionPatterns, undefined);

      expect(result.releaseType).toBe('patch');
      expect(result.parsedCommitCount).toBe(1);
      expect(result.unparseableCommits).toHaveLength(1);
    });
  });

  describe('ticket-prefix stripping integration', () => {
    it('parses commits with GitHub-style ticket prefixes', () => {
      const commits = [makeCommit('#8 feat: add thing')];
      const result = determineBumpFromCommits(commits, workTypes, versionPatterns, undefined);

      expect(result.releaseType).toBe('minor');
      expect(result.parsedCommitCount).toBe(1);
      expect(result.unparseableCommits).toBeUndefined();
    });

    it('parses commits with Jira-style ticket prefixes', () => {
      const commits = [makeCommit('TOOL-123 fix: resolve bug')];
      const result = determineBumpFromCommits(commits, workTypes, versionPatterns, undefined);

      expect(result.releaseType).toBe('patch');
      expect(result.parsedCommitCount).toBe(1);
      expect(result.unparseableCommits).toBeUndefined();
    });
  });

  describe('workspace alias resolution', () => {
    it('passes workspace aliases through to parseCommitMessage', () => {
      const aliases = { rk: 'release-kit' };
      const commits = [makeCommit('rk|feat: add thing')];
      const result = determineBumpFromCommits(commits, workTypes, versionPatterns, aliases);

      expect(result.releaseType).toBe('minor');
      expect(result.parsedCommitCount).toBe(1);
    });
  });
});
