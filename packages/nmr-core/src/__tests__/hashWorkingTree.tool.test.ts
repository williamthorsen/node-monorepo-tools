import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, test } from 'vitest';

import { hashWorkingTree } from '../hashWorkingTree.ts';

// Resolved to its physical path by `createTempTree`, so it compares equal to the toplevel git reports.
const it = test.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-tree-hash-' })),
);

describe(hashWorkingTree, () => {
  describe('what it reports', () => {
    it('reports the repository toplevel and HEAD commit alongside the hash', ({ tree }) => {
      initRepo(tree.dir);

      const result = hashWorkingTree(tree.dir);

      expect(result).toStrictEqual({
        ok: true,
        hash: expect.stringMatching(/^[\da-f]{64}$/),
        headSha: git(tree.dir, ['rev-parse', 'HEAD']).trim(),
        toplevel: tree.dir,
      });
    });

    it('reports the same toplevel from a subdirectory', ({ tree }) => {
      initRepo(tree.dir);
      const nested = path.join(tree.dir, 'packages', 'leaf');
      fs.mkdirSync(nested, { recursive: true });

      const result = hashWorkingTree(nested);

      expect(result).toMatchObject({ ok: true, toplevel: tree.dir });
    });

    it('is stable across repeated calls on an untouched tree', ({ tree }) => {
      initRepo(tree.dir);

      expect(hashOf(tree.dir)).toBe(hashOf(tree.dir));
    });
  });

  describe('what moves the hash', () => {
    it('leaves the hash alone when a touch changes no bytes', ({ tree }) => {
      // Timestamps are not content. A hash that moved on `touch` would miss on every checkout and clone.
      initRepo(tree.dir);
      const before = hashOf(tree.dir);

      const future = new Date(Date.now() + 60_000);
      fs.utimesSync(path.join(tree.dir, 'src', 'index.ts'), future, future);

      expect(hashOf(tree.dir)).toBe(before);
    });

    it('moves the hash when a tracked file’s content changes', ({ tree }) => {
      initRepo(tree.dir);
      const before = hashOf(tree.dir);

      fs.writeFileSync(path.join(tree.dir, 'src', 'index.ts'), 'export const value = 2;\n');

      expect(hashOf(tree.dir)).not.toBe(before);
    });

    it('moves the hash when an untracked file appears', ({ tree }) => {
      initRepo(tree.dir);
      const before = hashOf(tree.dir);

      fs.writeFileSync(path.join(tree.dir, 'src', 'added.ts'), 'export const added = true;\n');

      expect(hashOf(tree.dir)).not.toBe(before);
    });

    it('moves the hash when a tracked file is deleted', ({ tree }) => {
      initRepo(tree.dir);
      const before = hashOf(tree.dir);

      fs.rmSync(path.join(tree.dir, 'src', 'index.ts'));

      expect(hashOf(tree.dir)).not.toBe(before);
    });

    it('moves the hash when a change is staged', ({ tree }) => {
      initRepo(tree.dir);
      const before = hashOf(tree.dir);

      fs.writeFileSync(path.join(tree.dir, 'src', 'index.ts'), 'export const value = 3;\n');
      git(tree.dir, ['add', 'src/index.ts']);

      expect(hashOf(tree.dir)).not.toBe(before);
    });

    it('moves the hash when a file is renamed', ({ tree }) => {
      // A staged rename is the one status record carrying two paths; a parser that dropped the original path
      // would hash a rename exactly as it hashes an addition.
      initRepo(tree.dir);
      const before = hashOf(tree.dir);

      git(tree.dir, ['mv', 'src/index.ts', 'src/renamed.ts']);

      expect(statusRecordTypes(tree.dir)).toContain('2');
      expect(hashOf(tree.dir)).not.toBe(before);
    });

    it('moves the hash when a symlink is repointed', ({ tree }) => {
      initRepo(tree.dir);
      fs.symlinkSync('src/index.ts', path.join(tree.dir, 'link'));
      const before = hashOf(tree.dir);

      fs.rmSync(path.join(tree.dir, 'link'));
      fs.symlinkSync('src/other.ts', path.join(tree.dir, 'link'));

      expect(hashOf(tree.dir)).not.toBe(before);
    });

    it('moves the hash when a path containing spaces changes', ({ tree }) => {
      initRepo(tree.dir);
      const spaced = path.join(tree.dir, 'a file with spaces.txt');
      fs.writeFileSync(spaced, 'one\n');
      const before = hashOf(tree.dir);

      fs.writeFileSync(spaced, 'two\n');

      expect(hashOf(tree.dir)).not.toBe(before);
    });

    it('hashes a conflicted tree by the content standing in it', ({ tree }) => {
      // An unmerged path carries its own status record shape. Its working-tree content is what a check would
      // read, so it is what the hash describes.
      initRepo(tree.dir);
      const conflicted = startConflictingMerge(tree.dir);
      expect(statusRecordTypes(tree.dir)).toContain('u');
      const before = hashOf(tree.dir);

      fs.writeFileSync(conflicted, 'resolved\n');

      expect(hashOf(tree.dir)).not.toBe(before);
    });

    it('agrees across two branches holding identical content', ({ tree }) => {
      // The commit's tree object is the base of the fold, so two histories that arrive at the same content
      // hash alike, which is what lets a rebase or an amended message leave the hash where it was.
      initRepo(tree.dir);
      const onMain = hashOf(tree.dir);
      git(tree.dir, ['checkout', '-b', 'other']);
      fs.writeFileSync(path.join(tree.dir, 'src', 'index.ts'), 'export const value = 9;\n');
      commitAll(tree.dir, 'diverge');
      fs.writeFileSync(path.join(tree.dir, 'src', 'index.ts'), 'export const value = 1;\n');
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
      initRepo(tree.dir);
      fs.writeFileSync(path.join(tree.dir, '.gitmodules'), '[submodule "vendor"]\n\tpath = vendor\n');

      expect(hashWorkingTree(tree.dir)).toStrictEqual({
        ok: false,
        reason: expect.stringContaining('submodules'),
      });
    });

    it('refuses a tree holding an untracked nested repository', ({ tree }) => {
      // Git reports a nested repository as one entry and does not look inside it, so neither can the hash.
      initRepo(tree.dir);
      const nested = path.join(tree.dir, 'vendor');
      fs.mkdirSync(nested);
      git(nested, ['init', '--initial-branch=main']);
      fs.writeFileSync(path.join(nested, 'file.txt'), 'vendored\n');

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
function initRepo(repo: string): void {
  git(repo, ['init', '--initial-branch=main']);
  git(repo, ['config', 'user.email', 'fixture@example.com']);
  git(repo, ['config', 'user.name', 'Fixture']);
  git(repo, ['config', 'commit.gpgsign', 'false']);

  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'index.ts'), 'export const value = 1;\n');
  fs.writeFileSync(path.join(repo, 'src', 'other.ts'), 'export const other = 1;\n');
  commitAll(repo, 'initial');
}

/** Leaves the repository mid-merge with one conflicted path, and returns that path. */
function startConflictingMerge(repo: string): string {
  const conflicted = path.join(repo, 'src', 'index.ts');

  git(repo, ['checkout', '-b', 'theirs']);
  fs.writeFileSync(conflicted, 'export const value = 2;\n');
  commitAll(repo, 'theirs');

  git(repo, ['checkout', 'main']);
  fs.writeFileSync(conflicted, 'export const value = 3;\n');
  commitAll(repo, 'ours');

  try {
    git(repo, ['merge', 'theirs']);
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
