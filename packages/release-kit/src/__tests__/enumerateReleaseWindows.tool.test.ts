import { describe, expect, it } from 'vitest';

import { enumerateReleaseWindows, type ReleaseWindow } from '../enumerateReleaseWindows.ts';
import { type GitRepoFixture, scaffoldGitRepo } from '../test-utils/scaffoldGitRepo.ts';

/** Reduce windows to the shape the splitting assertions compare: version plus commit subjects. */
function summarize(windows: readonly ReleaseWindow[]): Array<{ version: string; subjects: string[] }> {
  return windows.map((window) => ({
    version: window.version,
    subjects: window.commits.map((commit) => commit.subject),
  }));
}

/** Build a three-release history: two tagged windows plus two commits above the newest tag. */
function seedTwoReleases(repo: GitRepoFixture): void {
  repo.commit('feat: first', { 'src/first.ts': 'export const first = 1;\n' });
  repo.tag('pkg-v1.0.0');
  repo.commit('feat: second', { 'src/second.ts': 'export const second = 2;\n' });
  repo.commit('fix: third', { 'src/third.ts': 'export const third = 3;\n' });
  repo.tag('pkg-v1.1.0');
  repo.commit('feat: fourth', { 'src/fourth.ts': 'export const fourth = 4;\n' });
  repo.commit('fix: fifth', { 'src/fifth.ts': 'export const fifth = 5;\n' });
}

/**
 * Build a history whose branch commit is older by commit date than the tag that does not
 * contain it: base, a branch commit, a tagged mainline commit, then a no-fast-forward merge.
 */
function seedMergedBranch(repo: GitRepoFixture): void {
  repo.commit('chore: base', { 'src/base.ts': 'export const base = 0;\n' }, { date: '2026-01-01T00:00:00Z' });
  repo.git('checkout', '--quiet', '-b', 'feat');
  repo.commit('feat: branch work', { 'src/branch.ts': 'export const branch = 1;\n' }, { date: '2026-01-02T00:00:00Z' });
  repo.git('checkout', '--quiet', 'main');
  repo.commit('chore: mainline work', { 'src/main.ts': 'export const main = 2;\n' }, { date: '2026-01-03T00:00:00Z' });
  repo.tag('pkg-v1.0.0');
  repo.merge('feat', 'Merge feat', { date: '2026-01-04T00:00:00Z' });
}

describe(enumerateReleaseWindows, () => {
  it('returns only the unreleased window for a repository with no commits', () => {
    scaffoldGitRepo();

    const windows = enumerateReleaseWindows({ tagPrefixes: ['pkg-v'], unreleasedTag: 'pkg-v1.0.0' });

    expect(summarize(windows)).toStrictEqual([{ version: 'pkg-v1.0.0', subjects: [] }]);
  });

  it('splits history at each matching tag, newest window first', () => {
    const repo = scaffoldGitRepo();
    seedTwoReleases(repo);

    const windows = enumerateReleaseWindows({ tagPrefixes: ['pkg-v'], unreleasedTag: 'pkg-v1.2.0' });

    expect(summarize(windows)).toStrictEqual([
      { version: 'pkg-v1.2.0', subjects: ['feat: fourth', 'fix: fifth'] },
      { version: 'pkg-v1.1.0', subjects: ['feat: second', 'fix: third'] },
      { version: 'pkg-v1.0.0', subjects: ['feat: first'] },
    ]);
  });

  it('assigns a tagged commit to its own window rather than the one above it', () => {
    const repo = scaffoldGitRepo();
    seedTwoReleases(repo);

    const windows = enumerateReleaseWindows({ tagPrefixes: ['pkg-v'], unreleasedTag: 'pkg-v1.2.0' });

    // `fix: third` carries the `pkg-v1.1.0` tag, so it closes that window instead of opening the next.
    expect(windows[1]?.commits.at(-1)?.subject).toBe('fix: third');
  });

  it('leaves the unreleased window empty when HEAD sits on a tag', () => {
    const repo = scaffoldGitRepo();
    repo.commit('feat: first', { 'src/first.ts': 'export const first = 1;\n' });
    repo.tag('pkg-v1.0.0');

    const windows = enumerateReleaseWindows({ tagPrefixes: ['pkg-v'], unreleasedTag: 'pkg-v1.1.0' });

    expect(summarize(windows)).toStrictEqual([
      { version: 'pkg-v1.1.0', subjects: [] },
      { version: 'pkg-v1.0.0', subjects: ['feat: first'] },
    ]);
  });

  it('drops a tag unreachable from HEAD', () => {
    const repo = scaffoldGitRepo();
    repo.commit('feat: first', { 'src/first.ts': 'export const first = 1;\n' });
    repo.git('checkout', '--quiet', '-b', 'side');
    repo.commit('feat: sidelined', { 'src/side.ts': 'export const side = 1;\n' });
    repo.tag('pkg-v9.0.0');
    repo.git('checkout', '--quiet', 'main');
    repo.commit('fix: second', { 'src/second.ts': 'export const second = 2;\n' });

    const windows = enumerateReleaseWindows({ tagPrefixes: ['pkg-v'], unreleasedTag: 'pkg-v1.0.0' });

    expect(summarize(windows)).toStrictEqual([{ version: 'pkg-v1.0.0', subjects: ['feat: first', 'fix: second'] }]);
  });

  it("leaves a branch commit merged after a tag out of that tag's window", () => {
    const repo = scaffoldGitRepo();
    seedMergedBranch(repo);

    const windows = enumerateReleaseWindows({ tagPrefixes: ['pkg-v'], unreleasedTag: 'pkg-v1.1.0' });

    // `feat: branch work` predates the tag by commit date but is not an ancestor of it.
    expect(summarize(windows)).toStrictEqual([
      { version: 'pkg-v1.1.0', subjects: ['feat: branch work', 'Merge feat'] },
      { version: 'pkg-v1.0.0', subjects: ['chore: base', 'chore: mainline work'] },
    ]);
  });

  it('assigns a commit to the oldest tag that contains it when two tags do', () => {
    const repo = scaffoldGitRepo();
    repo.commit('feat: first', { 'src/first.ts': 'export const first = 1;\n' });
    repo.tag('pkg-v1.0.0');
    repo.commit('feat: second', { 'src/second.ts': 'export const second = 2;\n' });
    repo.tag('pkg-v1.1.0');

    const windows = enumerateReleaseWindows({ tagPrefixes: ['pkg-v'], unreleasedTag: 'pkg-v1.2.0' });

    expect(summarize(windows)).toStrictEqual([
      { version: 'pkg-v1.2.0', subjects: [] },
      { version: 'pkg-v1.1.0', subjects: ['feat: second'] },
      { version: 'pkg-v1.0.0', subjects: ['feat: first'] },
    ]);
  });

  it('ignores a tag whose prefix is not followed by a digit', () => {
    const repo = scaffoldGitRepo();
    repo.commit('feat: first', { 'src/first.ts': 'export const first = 1;\n' });
    repo.tag('pkg-vnext');
    repo.commit('fix: second', { 'src/second.ts': 'export const second = 2;\n' });

    const windows = enumerateReleaseWindows({ tagPrefixes: ['pkg-v'], unreleasedTag: 'pkg-v1.0.0' });

    expect(summarize(windows)).toStrictEqual([{ version: 'pkg-v1.0.0', subjects: ['feat: first', 'fix: second'] }]);
  });

  it('matches every listed prefix as a union', () => {
    const repo = scaffoldGitRepo();
    repo.commit('feat: first', { 'src/first.ts': 'export const first = 1;\n' });
    repo.tag('legacy-v1.0.0');
    repo.commit('feat: second', { 'src/second.ts': 'export const second = 2;\n' });
    repo.tag('pkg-v2.0.0');
    repo.commit('fix: third', { 'src/third.ts': 'export const third = 3;\n' });

    const windows = enumerateReleaseWindows({
      tagPrefixes: ['pkg-v', 'legacy-v'],
      unreleasedTag: 'pkg-v2.0.1',
    });

    expect(summarize(windows)).toStrictEqual([
      { version: 'pkg-v2.0.1', subjects: ['fix: third'] },
      { version: 'pkg-v2.0.0', subjects: ['feat: second'] },
      { version: 'legacy-v1.0.0', subjects: ['feat: first'] },
    ]);
  });

  it('restricts the enumeration to commits touching the given paths', () => {
    const repo = scaffoldGitRepo();
    repo.commit('feat: in scope', { 'packages/a/index.ts': 'export const a = 1;\n' });
    repo.commit('feat: out of scope', { 'packages/b/index.ts': 'export const b = 1;\n' });

    const windows = enumerateReleaseWindows({
      paths: ['packages/a/**'],
      tagPrefixes: ['pkg-v'],
      unreleasedTag: 'pkg-v1.0.0',
    });

    expect(summarize(windows)).toStrictEqual([{ version: 'pkg-v1.0.0', subjects: ['feat: in scope'] }]);
  });

  it('carries the hash, subject, body, and full message of each commit', () => {
    const repo = scaffoldGitRepo();
    const hash = repo.commit('feat: add a thing\n\nExplains the thing.\n\nChange: pkg|feat: Adds a thing.', {
      'src/thing.ts': 'export const thing = 1;\n',
    });

    const windows = enumerateReleaseWindows({ tagPrefixes: ['pkg-v'], unreleasedTag: 'pkg-v1.0.0' });

    expect(windows[0]?.commits).toStrictEqual([
      {
        hash,
        subject: 'feat: add a thing',
        body: 'Explains the thing.\n\nChange: pkg|feat: Adds a thing.',
        message: 'feat: add a thing\n\nExplains the thing.\n\nChange: pkg|feat: Adds a thing.',
      },
    ]);
  });

  it('reports an empty body for a commit that carries none', () => {
    const repo = scaffoldGitRepo();
    repo.commit('feat: subject only', { 'src/thing.ts': 'export const thing = 1;\n' });

    const windows = enumerateReleaseWindows({ tagPrefixes: ['pkg-v'], unreleasedTag: 'pkg-v1.0.0' });

    expect(windows[0]?.commits[0]?.body).toBe('');
  });

  it('dates the unreleased window from the clock and a released window from its tag', () => {
    const repo = scaffoldGitRepo();
    repo.commit('feat: first', { 'src/first.ts': 'export const first = 1;\n' });
    repo.tag('pkg-v1.0.0');
    repo.commit('fix: second', { 'src/second.ts': 'export const second = 2;\n' });
    const taggerSeconds = Number(repo.git('for-each-ref', '--format=%(creatordate:unix)', 'refs/tags/pkg-v1.0.0'));

    const windows = enumerateReleaseWindows({
      now: () => 1_700_000_000_500,
      tagPrefixes: ['pkg-v'],
      unreleasedTag: 'pkg-v1.0.1',
    });

    expect(windows[0]?.timestamp).toBe(1_700_000_000);
    expect(windows[1]?.timestamp).toBe(taggerSeconds);
  });

  it('throws when tagPrefixes is empty', () => {
    scaffoldGitRepo();

    expect(() => enumerateReleaseWindows({ tagPrefixes: [], unreleasedTag: 'pkg-v1.0.0' })).toThrow(
      'enumerateReleaseWindows: tagPrefixes must contain at least one entry',
    );
  });
});
