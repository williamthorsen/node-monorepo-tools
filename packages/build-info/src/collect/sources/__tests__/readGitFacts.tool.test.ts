import { execFileSync } from 'node:child_process';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { readGitFacts } from '../readGitFacts.ts';

describe('readGitFacts (tool)', () => {
  it('reads a real checkout', () => {
    using tree = createTree({ 'README.md': '# app\n' });
    git(tree, 'init', '--quiet', '--initial-branch=main');
    git(tree, 'remote', 'add', 'origin', 'https://github.com/acme/app.git');
    git(tree, 'add', '--all');
    git(tree, 'commit', '--quiet', '--message', 'Add the readme');
    tree.write('notes.txt', 'untracked\n');

    const facts = readGitFacts(tree.dir);

    expect(facts).toStrictEqual({
      sha: git(tree, 'rev-parse', 'HEAD'),
      message: 'Add the readme',
      author: 'Test User',
      time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      ref: 'main',
      dirty: false,
      remoteUrl: 'https://github.com/acme/app.git',
    });
  });

  it('reports a modified tracked file as dirty', () => {
    using tree = createTree({ 'README.md': '# app\n' });
    git(tree, 'init', '--quiet', '--initial-branch=main');
    git(tree, 'add', '--all');
    git(tree, 'commit', '--quiet', '--message', 'Add the readme');
    tree.write('README.md', '# changed\n');

    expect(readGitFacts(tree.dir).dirty).toBe(true);
  });

  it('returns no facts outside a repository', () => {
    using tree = createTree({ 'package.json': '{}' });
    // Keep git from discovering a repository that encloses the temporary directory.
    vi.stubEnv('GIT_CEILING_DIRECTORIES', tree.dir);
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });

    expect(readGitFacts(tree.dir)).toStrictEqual({});
  });
});

// region | Helpers

/** Creates a temporary directory holding the given files, removed when its binding is disposed. */
function createTree(entries: Record<string, string>): TempTree {
  return createTempTree(entries, { prefix: 'build-info-git-' });
}

/** Runs git in the tree with a fixed identity and returns its trimmed output. */
function git(tree: TempTree, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=Test User', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd: tree.dir, encoding: 'utf8' },
  ).trim();
}

// endregion | Helpers
