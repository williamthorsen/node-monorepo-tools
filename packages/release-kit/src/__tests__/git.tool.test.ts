import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createTempTree, pointCwdAt } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it } from 'vitest';

import { realGit } from '../git.ts';
import { type GitRepoFixture, scaffoldGitRepo } from '../test-utils/scaffoldGitRepo.ts';

const GIT_MODULE_PATH = fileURLToPath(new URL('../git.ts', import.meta.url));

describe('realGit', () => {
  describe('outside a repository', () => {
    it('reports that the directory is not inside a work tree', () => {
      enterPlainDirectory();

      expect(realGit.isInsideWorkTree()).toBe(false);
    });

    it("throws git's error when a command fails", () => {
      enterPlainDirectory();

      expect(() => realGit.readStatus()).toThrow(/not a git repository/i);
    });
  });

  describe('in a repository without commits', () => {
    it('reads an empty ancestry', () => {
      scaffoldGitRepo();

      expect(realGit.readAncestry()).toStrictEqual([]);
    });

    it('reports that the directory is inside a work tree', () => {
      scaffoldGitRepo();

      expect(realGit.isInsideWorkTree()).toBe(true);
    });
  });

  describe('reads', () => {
    it("reads the ancestry newest first, with each commit's parents", () => {
      const repo = scaffoldGitRepo();
      const first = repo.commit('chore: first');
      const second = repo.commit('chore: second');

      expect(realGit.readAncestry()).toStrictEqual([
        { hash: second, parents: [first] },
        { hash: first, parents: [] },
      ]);
    });

    it('reads commits newest first, splitting a multi-line message into subject and body', () => {
      const repo = scaffoldGitRepo();
      const first = repo.commit('feat: first', { 'a.txt': 'a\n' });
      const second = repo.commit('fix: second\n\nThe body.\n\nA second paragraph.', { 'b.txt': 'b\n' });

      expect(realGit.readCommits()).toStrictEqual([
        {
          hash: second,
          subject: 'fix: second',
          body: 'The body.\n\nA second paragraph.',
          message: 'fix: second\n\nThe body.\n\nA second paragraph.',
        },
        { hash: first, subject: 'feat: first', body: '', message: 'feat: first' },
      ]);
    });

    it('reads only the commits that touch the given paths', () => {
      const repo = scaffoldGitRepo();
      repo.commit('feat: a', { 'a/file.txt': 'a\n' });
      repo.commit('feat: b', { 'b/file.txt': 'b\n' });

      expect(realGit.readCommits(['a']).map((commit) => commit.subject)).toStrictEqual(['feat: a']);
    });

    it('lists annotated and lightweight tags with the commit at which each points', () => {
      const repo = scaffoldGitRepo();
      const first = repo.commit('chore: first');
      repo.tag('pkg-v1.0.0');
      const second = repo.commit('chore: second');
      repo.runGit('tag', 'pkg-v1.1.0');

      const refs = realGit.listTagRefs();

      expect(refs.map(({ tag, commitHash }) => ({ tag, commitHash }))).toStrictEqual([
        { tag: 'pkg-v1.0.0', commitHash: first },
        { tag: 'pkg-v1.1.0', commitHash: second },
      ]);
      for (const ref of refs) {
        expect(Number.isSafeInteger(ref.timestampSec) && ref.timestampSec > 0).toBe(true);
      }
    });

    it('lists tags, filtered by a pattern when one is given', () => {
      const repo = scaffoldGitRepo();
      repo.commit('chore: first');
      repo.tag('app-v1.0.0');
      repo.tag('lib-v1.0.0');

      expect(realGit.listTags()).toStrictEqual(['app-v1.0.0', 'lib-v1.0.0']);
      expect(realGit.listTags('lib-v*')).toStrictEqual(['lib-v1.0.0']);
    });

    it('lists only the tags at HEAD', () => {
      const repo = scaffoldGitRepo();
      repo.commit('chore: first');
      repo.tag('pkg-v1.0.0');
      repo.commit('chore: second');
      repo.tag('pkg-v1.1.0');

      expect(realGit.listTagsAtHead()).toStrictEqual(['pkg-v1.1.0']);
    });

    it('reads the current branch', () => {
      const repo = scaffoldGitRepo();
      repo.commit('chore: first');

      expect(realGit.readCurrentBranch()).toBe('main');
    });

    it('reads the porcelain status, empty when the tree is clean', () => {
      const repo = scaffoldGitRepo();
      repo.commit('chore: first', { 'tracked.txt': 'one\n' });

      expect(realGit.readStatus()).toBe('');

      repo.write('untracked.txt', 'new\n');

      expect(realGit.readStatus()).toBe('?? untracked.txt');
    });
  });

  describe('hasTrackedChanges', () => {
    it('ignores an untracked file', () => {
      const repo = scaffoldGitRepo();
      repo.commit('chore: first', { 'tracked.txt': 'one\n' });
      repo.write('untracked.txt', 'new\n');

      expect(realGit.hasTrackedChanges()).toBe(false);
    });

    it('reports an unstaged change to a tracked file', () => {
      const repo = scaffoldGitRepo();
      repo.commit('chore: first', { 'tracked.txt': 'one\n' });
      repo.write('tracked.txt', 'two\n');

      expect(realGit.hasTrackedChanges()).toBe(true);
    });

    it('reports a staged change', () => {
      const repo = scaffoldGitRepo();
      repo.commit('chore: first', { 'tracked.txt': 'one\n' });
      repo.write('staged.txt', 'new\n');
      repo.runGit('add', 'staged.txt');

      expect(realGit.hasTrackedChanges()).toBe(true);
    });
  });

  describe('writes', () => {
    it('stages every change and commits it', () => {
      const repo = scaffoldGitRepo();
      repo.commit('chore: first');
      repo.write('new.txt', 'new\n');

      realGit.addAll();
      realGit.commit('release: pkg-v1.0.0\n\nThe summary.');

      expect(realGit.readStatus()).toBe('');
      expect(realGit.readCommits()[0]).toMatchObject({ subject: 'release: pkg-v1.0.0', body: 'The summary.' });
    });

    it('creates an annotated tag whose message is its name', () => {
      const repo = scaffoldGitRepo();
      repo.commit('chore: first');

      realGit.createAnnotatedTag('pkg-v1.0.0');

      expect(repo.runGit('cat-file', '-t', 'pkg-v1.0.0')).toBe('tag');
      expect(repo.runGit('tag', '--list', '--format=%(contents:subject)', 'pkg-v1.0.0')).toBe('pkg-v1.0.0');
    });
  });

  describe('pushes', () => {
    it("pushes a branch to origin, writing git's output to the inherited stream", () => {
      const repo = scaffoldGitRepoWithRemote();
      repo.commit('chore: first');

      const { status, stderr } = runInChild(repo, `realGit.pushBranch('main')`);

      expect(status).toBe(0);
      expect(stderr).toContain('main -> main');
      expect(readRemoteRefs(repo)).toContain('refs/heads/main');
    });

    it('pushes one tag without the tags that follow it', () => {
      const repo = scaffoldGitRepoWithRemote();
      repo.commit('chore: first');
      repo.tag('pkg-v1.0.0');
      repo.tag('other-v1.0.0');

      const { status, stderr } = runInChild(repo, `realGit.pushTag('pkg-v1.0.0')`);

      expect(status).toBe(0);
      expect(stderr).toContain('pkg-v1.0.0');
      const remoteRefs = readRemoteRefs(repo);
      expect(remoteRefs).toContain('refs/tags/pkg-v1.0.0');
      expect(remoteRefs).not.toContain('refs/tags/other-v1.0.0');
    });

    it('throws when the push fails', () => {
      const repo = scaffoldGitRepoWithRemote();
      repo.commit('chore: first');

      const { status, stderr } = runInChild(repo, `realGit.pushTag('missing-v1.0.0')`);

      expect(status).not.toBe(0);
      expect(stderr).toMatch(/missing-v1\.0\.0/);
    });
  });
});

// region | Helpers

/** Points the process at a fresh directory that is not inside any git repository. */
function enterPlainDirectory(): void {
  const tree = disposeOnTestFinished(createTempTree({}, { prefix: 'release-kit-plain-' }));
  disposeOnTestFinished(pointCwdAt(tree.dir, { chdir: true }));
}

/** Lists the refs of the repository's `origin`. */
function readRemoteRefs(repo: GitRepoFixture): string {
  return repo.runGit('ls-remote', 'origin');
}

/**
 * Runs `statement` against `realGit` in a child process whose stdio the test captures, because a push writes to the
 * stream that it inherits.
 */
function runInChild(repo: GitRepoFixture, statement: string): { status: number | null; stderr: string } {
  const script = `import { realGit } from ${JSON.stringify(GIT_MODULE_PATH)};\n${statement};`;
  const { status, stderr } = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: repo.dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { status, stderr };
}

/** Scaffolds a repository whose `origin` is a bare repository in its own temp directory. */
function scaffoldGitRepoWithRemote(): GitRepoFixture {
  const remote = disposeOnTestFinished(createTempTree({}, { prefix: 'release-kit-remote-' }));
  execFileSync('git', ['init', '--quiet', '--bare', remote.dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  const repo = scaffoldGitRepo();
  repo.runGit('remote', 'add', 'origin', remote.dir);
  return repo;
}

// endregion | Helpers
