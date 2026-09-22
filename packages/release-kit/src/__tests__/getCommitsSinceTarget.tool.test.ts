import { describe, expect, it } from 'vitest';

import { getCommitsSinceTarget } from '../getCommitsSinceTarget.ts';
import { type GitRepoFixture, scaffoldGitRepo } from '../test-utils/scaffoldGitRepo.ts';

/** Build a tagged baseline with two commits above it. */
function seedTaggedBaseline(repo: GitRepoFixture): void {
  repo.commit('feat: released', { 'src/released.ts': 'export const released = 1;\n' });
  repo.tag('arrays-v1.0.0');
  repo.commit('feat: newer', { 'src/newer.ts': 'export const newer = 2;\n' });
  repo.commit('fix: newest', { 'src/newest.ts': 'export const newest = 3;\n' });
}

describe(getCommitsSinceTarget, () => {
  it('returns the baseline tag and the commits above it, newest first', () => {
    const repo = scaffoldGitRepo();
    seedTaggedBaseline(repo);

    const result = getCommitsSinceTarget(['arrays-v']);

    expect(result.tag).toBe('arrays-v1.0.0');
    expect(result.commits.map((commit) => commit.subject)).toStrictEqual(['fix: newest', 'feat: newer']);
  });

  it('returns no commits when HEAD sits on the baseline tag', () => {
    const repo = scaffoldGitRepo();
    repo.commit('feat: released', { 'src/released.ts': 'export const released = 1;\n' });
    repo.tag('arrays-v1.0.0');

    const result = getCommitsSinceTarget(['arrays-v']);

    expect(result.tag).toBe('arrays-v1.0.0');
    expect(result.commits).toStrictEqual([]);
  });

  it('returns every commit and no tag when no matching tag exists', () => {
    const repo = scaffoldGitRepo();
    repo.commit('feat: first', { 'src/first.ts': 'export const first = 1;\n' });
    repo.tag('other-v1.0.0');
    repo.commit('fix: second', { 'src/second.ts': 'export const second = 2;\n' });

    const result = getCommitsSinceTarget(['arrays-v']);

    expect(result.tag).toBeUndefined();
    expect(result.commits.map((commit) => commit.subject)).toStrictEqual(['fix: second', 'feat: first']);
  });

  it('names the newest matching tag when several are reachable', () => {
    const repo = scaffoldGitRepo();
    repo.commit('feat: first', { 'src/first.ts': 'export const first = 1;\n' });
    repo.tag('arrays-v1.0.0');
    repo.commit('feat: second', { 'src/second.ts': 'export const second = 2;\n' });
    repo.tag('arrays-v1.1.0');
    repo.commit('fix: third', { 'src/third.ts': 'export const third = 3;\n' });

    const result = getCommitsSinceTarget(['arrays-v']);

    expect(result.tag).toBe('arrays-v1.1.0');
    expect(result.commits.map((commit) => commit.subject)).toStrictEqual(['fix: third']);
  });

  it('reports a branch commit merged after the baseline tag', () => {
    const repo = scaffoldGitRepo();
    repo.commit('chore: base', { 'src/base.ts': 'export const base = 0;\n' }, { date: '2026-01-01T00:00:00Z' });
    repo.git('checkout', '--quiet', '-b', 'feat');
    repo.commit(
      'feat: branch work',
      { 'src/branch.ts': 'export const branch = 1;\n' },
      { date: '2026-01-02T00:00:00Z' },
    );
    repo.git('checkout', '--quiet', 'main');
    repo.commit('chore: mainline', { 'src/main.ts': 'export const main = 2;\n' }, { date: '2026-01-03T00:00:00Z' });
    repo.tag('arrays-v1.0.0');
    repo.merge('feat', 'Merge feat', { date: '2026-01-04T00:00:00Z' });

    const result = getCommitsSinceTarget(['arrays-v']);

    // The branch commit is older by commit date than the tag, and the tag does not contain it.
    expect(result.tag).toBe('arrays-v1.0.0');
    expect(result.commits.map((commit) => commit.subject)).toStrictEqual(['Merge feat', 'feat: branch work']);
  });

  it('searches every listed prefix as a union', () => {
    const repo = scaffoldGitRepo();
    repo.commit('feat: first', { 'src/first.ts': 'export const first = 1;\n' });
    repo.tag('core-v0.2.7');
    repo.commit('fix: second', { 'src/second.ts': 'export const second = 2;\n' });

    const result = getCommitsSinceTarget(['nmr-core-v', 'core-v']);

    expect(result.tag).toBe('core-v0.2.7');
    expect(result.commits.map((commit) => commit.subject)).toStrictEqual(['fix: second']);
  });

  it('filters out release commits', () => {
    const repo = scaffoldGitRepo();
    repo.commit('feat: released', { 'src/released.ts': 'export const released = 1;\n' });
    repo.tag('arrays-v1.0.0');
    repo.commit('feat: add feature', { 'src/feature.ts': 'export const feature = 1;\n' });
    repo.commit('release: arrays-v1.1.0 strings-v2.0.1', { 'CHANGELOG.md': '# Changelog\n' });
    repo.commit('fix: patch bug', { 'src/patch.ts': 'export const patch = 1;\n' });

    const result = getCommitsSinceTarget(['arrays-v']);

    expect(result.commits.map((commit) => commit.subject)).toStrictEqual(['fix: patch bug', 'feat: add feature']);
  });

  it('restricts the commits to the given paths', () => {
    const repo = scaffoldGitRepo();
    repo.commit('feat: released', { 'src/released.ts': 'export const released = 1;\n' });
    repo.tag('arrays-v1.0.0');
    repo.commit('feat: in scope', { 'packages/arrays/index.ts': 'export const a = 1;\n' });
    repo.commit('feat: out of scope', { 'packages/strings/index.ts': 'export const s = 1;\n' });

    const result = getCommitsSinceTarget(['arrays-v'], ['packages/arrays/**']);

    expect(result.commits.map((commit) => commit.subject)).toStrictEqual(['feat: in scope']);
  });

  it('carries the body of a commit that has one', () => {
    const repo = scaffoldGitRepo();
    repo.commit('feat: add a thing\n\nChange: arrays|feat: Adds a thing.', {
      'src/thing.ts': 'export const thing = 1;\n',
    });

    const result = getCommitsSinceTarget(['arrays-v']);

    expect(result.commits[0]?.subject).toBe('feat: add a thing');
    expect(result.commits[0]?.body).toBe('Change: arrays|feat: Adds a thing.');
    expect(result.commits[0]?.message).toBe('feat: add a thing\n\nChange: arrays|feat: Adds a thing.');
  });

  it('throws when the prefix array is empty', () => {
    scaffoldGitRepo();

    expect(() => getCommitsSinceTarget([])).toThrow(
      'enumerateReleaseWindows: tagPrefixes must contain at least one entry',
    );
  });
});
