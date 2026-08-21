import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { hashWorkingTree } from '../hashWorkingTree.ts';

// Resolved to its physical path by `createTempTree`, so it compares equal to the toplevel git reports.
// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-tree-hash-' })),
);

describe(hashWorkingTree, () => {
  describe('what it reports', () => {
    it('reports the repository toplevel and HEAD commit alongside the hash', ({ tree }) => {
      initRepo(tree);

      const result = hashWorkingTree(tree.dir);

      expect(result).toStrictEqual({
        ok: true,
        hash: expect.stringMatching(/^[\da-f]{64}$/),
        headSha: git(tree.dir, ['rev-parse', 'HEAD']).trim(),
        toplevel: tree.dir,
      });
    });

    it('reports the same toplevel from a subdirectory', ({ tree }) => {
      initRepo(tree);
      const nested = tree.mkdir('packages/leaf');

      const result = hashWorkingTree(nested);

      expect(result).toMatchObject({ ok: true, toplevel: tree.dir });
    });

    it('is stable across repeated calls on an untouched tree', ({ tree }) => {
      initRepo(tree);

      expect(hashOf(tree.dir)).toBe(hashOf(tree.dir));
    });
  });

  describe('what moves the hash', () => {
    it('leaves the hash alone when a touch changes no bytes', ({ tree }) => {
      // Timestamps are not content. A hash that moved on `touch` would miss on every checkout and clone.
      initRepo(tree);
      const before = hashOf(tree.dir);

      const future = new Date(Date.now() + 60_000);
      fs.utimesSync(path.join(tree.dir, 'src', 'index.ts'), future, future);

      expect(hashOf(tree.dir)).toBe(before);
    });

    it('moves the hash when a tracked file’s content changes', ({ tree }) => {
      initRepo(tree);
      const before = hashOf(tree.dir);

      tree.write('src/index.ts', 'export const value = 2;\n');

      expect(hashOf(tree.dir)).not.toBe(before);
    });

    it('moves the hash when an untracked file appears', ({ tree }) => {
      initRepo(tree);
      const before = hashOf(tree.dir);

      tree.write('src/added.ts', 'export const added = true;\n');

      expect(hashOf(tree.dir)).not.toBe(before);
    });

    it('moves the hash when a tracked file is deleted', ({ tree }) => {
      initRepo(tree);
      const before = hashOf(tree.dir);

      fs.rmSync(path.join(tree.dir, 'src', 'index.ts'));

      expect(hashOf(tree.dir)).not.toBe(before);
    });

    it('moves the hash when a change is staged', ({ tree }) => {
      initRepo(tree);
      const before = hashOf(tree.dir);

      tree.write('src/index.ts', 'export const value = 3;\n');
      git(tree.dir, ['add', 'src/index.ts']);

      expect(hashOf(tree.dir)).not.toBe(before);
    });

    it('moves the hash when a file is renamed', ({ tree }) => {
      // A staged rename is the one status record carrying two paths; a parser that dropped the original path
      // would hash a rename exactly as it hashes an addition.
      initRepo(tree);
      const before = hashOf(tree.dir);

      git(tree.dir, ['mv', 'src/index.ts', 'src/renamed.ts']);

      expect(statusRecordTypes(tree.dir)).toContain('2');
      expect(hashOf(tree.dir)).not.toBe(before);
    });

    it('moves the hash when a symlink is repointed', ({ tree }) => {
      initRepo(tree);
      tree.symlink('link', 'src/index.ts');
      const before = hashOf(tree.dir);

      fs.rmSync(path.join(tree.dir, 'link'));
      tree.symlink('link', 'src/other.ts');

      expect(hashOf(tree.dir)).not.toBe(before);
    });

    it('moves the hash when a path containing spaces changes', ({ tree }) => {
      initRepo(tree);
      const spaced = 'a file with spaces.txt';
      tree.write(spaced, 'one\n');
      const before = hashOf(tree.dir);

      tree.write(spaced, 'two\n');

      expect(hashOf(tree.dir)).not.toBe(before);
    });

    it('hashes a conflicted tree by the content standing in it', ({ tree }) => {
      // An unmerged path carries its own status record shape. Its working-tree content is what a check would
      // read, so it is what the hash describes.
      initRepo(tree);
      const conflicted = startConflictingMerge(tree);
      expect(statusRecordTypes(tree.dir)).toContain('u');
      const before = hashOf(tree.dir);

      tree.write(conflicted, 'resolved\n');

      expect(hashOf(tree.dir)).not.toBe(before);
    });

    it('agrees across two branches holding identical content', ({ tree }) => {
      // The commit's tree object is the base of the fold, so two histories that arrive at the same content
      // hash alike, which is what lets a rebase or an amended message leave the hash where it was.
      initRepo(tree);
      const onMain = hashOf(tree.dir);
      git(tree.dir, ['checkout', '-b', 'other']);
      tree.write('src/index.ts', 'export const value = 9;\n');
      commitAll(tree.dir, 'diverge');
      tree.write('src/index.ts', 'export const value = 1;\n');
      commitAll(tree.dir, 'return to the original content');

      expect(hashOf(tree.dir)).toBe(onMain);
    });
  });

  describe('when it refuses to answer', () => {
    it('refuses outside a git repository', ({ tree }) => {
      expect(hashWorkingTree(tree.dir)).toStrictEqual({
        ok: false,
        reason: expect.stringContaining('not a git repository'),
      });
    });

    it('refuses a repository with no commit', ({ tree }) => {
      git(tree.dir, ['init', '--initial-branch=main']);

      expect(hashWorkingTree(tree.dir)).toStrictEqual({
        ok: false,
        reason: expect.stringContaining('no commit at HEAD'),
      });
    });

    it('refuses a repository declaring submodules', ({ tree }) => {
      // A submodule's content lives in a repository this hash never opens, so certifying the superproject
      // alone would certify content nothing examined.
      initRepo(tree);
      tree.write('.gitmodules', '[submodule "vendor"]\n\tpath = vendor\n');

      expect(hashWorkingTree(tree.dir)).toStrictEqual({
        ok: false,
        reason: expect.stringContaining('submodules'),
      });
    });

    it('refuses a tree holding an untracked nested repository', ({ tree }) => {
      // Git reports a nested repository as one entry and does not look inside it, so neither can the hash.
      initRepo(tree);
      const nested = tree.mkdir('vendor');
      git(nested, ['init', '--initial-branch=main']);
      tree.write('vendor/file.txt', 'vendored\n');

      expect(hashWorkingTree(tree.dir)).toStrictEqual({
        ok: false,
        reason: expect.stringContaining('neither a file nor a symlink'),
      });
    });
  });
});

// region | Helpers

/** Stages everything and commits it. */
function commitAll(repo: string, message: string): void {
  git(repo, ['add', '--all']);
  git(repo, ['commit', '--message', message]);
}

/** Runs git in `cwd` and returns its stdout. */
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Returns the hash, failing the test if the tree could not be hashed. */
function hashOf(cwd: string): string {
  const result = hashWorkingTree(cwd);
  if (!result.ok) {
    throw new Error(`expected a hash, got: ${result.reason}`);
  }
  return result.hash;
}

/** Writes a committed fixture repository: two source files on `main`, nothing dirty. */
function initRepo(tree: TempTree): void {
  git(tree.dir, ['init', '--initial-branch=main']);
  git(tree.dir, ['config', 'user.email', 'fixture@example.com']);
  git(tree.dir, ['config', 'user.name', 'Fixture']);
  git(tree.dir, ['config', 'commit.gpgsign', 'false']);

  tree.writeAll({
    'src/index.ts': 'export const value = 1;\n',
    'src/other.ts': 'export const other = 1;\n',
  });
  commitAll(tree.dir, 'initial');
}

/** Leaves the repository mid-merge with one conflicted path, and returns its entry path. */
function startConflictingMerge(tree: TempTree): string {
  const conflicted = 'src/index.ts';

  git(tree.dir, ['checkout', '-b', 'theirs']);
  tree.write(conflicted, 'export const value = 2;\n');
  commitAll(tree.dir, 'theirs');

  git(tree.dir, ['checkout', 'main']);
  tree.write(conflicted, 'export const value = 3;\n');
  commitAll(tree.dir, 'ours');

  try {
    git(tree.dir, ['merge', 'theirs']);
  } catch {
    // The merge is expected to stop on a conflict; that state is the fixture.
  }

  return conflicted;
}

/**
 * Returns the leading character of every `--porcelain=v2` record git currently reports, so a test can pin which
 * record shape its fixture produces rather than assume it.
 */
function statusRecordTypes(repo: string): string[] {
  return git(repo, ['status', '--porcelain=v2', '-z', '--untracked-files=all'])
    .split('\0')
    .filter((record) => record !== '')
    .map((record) => record.slice(0, 1));
}

// endregion | Helpers
