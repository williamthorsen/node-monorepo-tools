import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hashWorkingTree } from '../hashWorkingTree.ts';

describe(hashWorkingTree, () => {
  let repo: string;

  beforeEach(() => {
    repo = makeTemporaryDir();
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  describe('what it reports', () => {
    it('reports the repository toplevel and HEAD commit alongside the hash', () => {
      initRepo(repo);

      const result = hashWorkingTree(repo);

      expect(result).toStrictEqual({
        ok: true,
        hash: expect.stringMatching(/^[\da-f]{64}$/),
        headSha: git(repo, ['rev-parse', 'HEAD']).trim(),
        toplevel: repo,
      });
    });

    it('reports the same toplevel from a subdirectory', () => {
      initRepo(repo);
      const nested = path.join(repo, 'packages', 'leaf');
      fs.mkdirSync(nested, { recursive: true });

      const result = hashWorkingTree(nested);

      expect(result).toMatchObject({ ok: true, toplevel: repo });
    });

    it('is stable across repeated calls on an untouched tree', () => {
      initRepo(repo);

      expect(hashOf(repo)).toBe(hashOf(repo));
    });
  });

  describe('what moves the hash', () => {
    it('leaves the hash alone when a touch changes no bytes', () => {
      // Timestamps are not content. A hash that moved on `touch` would miss on every checkout and clone.
      initRepo(repo);
      const before = hashOf(repo);

      const future = new Date(Date.now() + 60_000);
      fs.utimesSync(path.join(repo, 'src', 'index.ts'), future, future);

      expect(hashOf(repo)).toBe(before);
    });

    it('moves the hash when a tracked file’s content changes', () => {
      initRepo(repo);
      const before = hashOf(repo);

      fs.writeFileSync(path.join(repo, 'src', 'index.ts'), 'export const value = 2;\n');

      expect(hashOf(repo)).not.toBe(before);
    });

    it('moves the hash when an untracked file appears', () => {
      initRepo(repo);
      const before = hashOf(repo);

      fs.writeFileSync(path.join(repo, 'src', 'added.ts'), 'export const added = true;\n');

      expect(hashOf(repo)).not.toBe(before);
    });

    it('moves the hash when a tracked file is deleted', () => {
      initRepo(repo);
      const before = hashOf(repo);

      fs.rmSync(path.join(repo, 'src', 'index.ts'));

      expect(hashOf(repo)).not.toBe(before);
    });

    it('moves the hash when a change is staged', () => {
      initRepo(repo);
      const before = hashOf(repo);

      fs.writeFileSync(path.join(repo, 'src', 'index.ts'), 'export const value = 3;\n');
      git(repo, ['add', 'src/index.ts']);

      expect(hashOf(repo)).not.toBe(before);
    });

    it('moves the hash when a file is renamed', () => {
      // A staged rename is the one status record carrying two paths; a parser that dropped the original path
      // would hash a rename exactly as it hashes an addition.
      initRepo(repo);
      const before = hashOf(repo);

      git(repo, ['mv', 'src/index.ts', 'src/renamed.ts']);

      expect(statusRecordTypes(repo)).toContain('2');
      expect(hashOf(repo)).not.toBe(before);
    });

    it('moves the hash when a symlink is repointed', () => {
      initRepo(repo);
      fs.symlinkSync('src/index.ts', path.join(repo, 'link'));
      const before = hashOf(repo);

      fs.rmSync(path.join(repo, 'link'));
      fs.symlinkSync('src/other.ts', path.join(repo, 'link'));

      expect(hashOf(repo)).not.toBe(before);
    });

    it('moves the hash when a path containing spaces changes', () => {
      initRepo(repo);
      const spaced = path.join(repo, 'a file with spaces.txt');
      fs.writeFileSync(spaced, 'one\n');
      const before = hashOf(repo);

      fs.writeFileSync(spaced, 'two\n');

      expect(hashOf(repo)).not.toBe(before);
    });

    it('hashes a conflicted tree by the content standing in it', () => {
      // An unmerged path carries its own status record shape. Its working-tree content is what a check would
      // read, so it is what the hash describes.
      initRepo(repo);
      const conflicted = startConflictingMerge(repo);
      expect(statusRecordTypes(repo)).toContain('u');
      const before = hashOf(repo);

      fs.writeFileSync(conflicted, 'resolved\n');

      expect(hashOf(repo)).not.toBe(before);
    });

    it('agrees across two branches holding identical content', () => {
      // The commit's tree object is the base of the fold, so two histories that arrive at the same content
      // hash alike -- which is what lets a rebase or an amended message leave the hash where it was.
      initRepo(repo);
      const onMain = hashOf(repo);
      git(repo, ['checkout', '-b', 'other']);
      fs.writeFileSync(path.join(repo, 'src', 'index.ts'), 'export const value = 9;\n');
      commitAll(repo, 'diverge');
      fs.writeFileSync(path.join(repo, 'src', 'index.ts'), 'export const value = 1;\n');
      commitAll(repo, 'return to the original content');

      expect(hashOf(repo)).toBe(onMain);
    });
  });

  describe('when it refuses to answer', () => {
    it('refuses outside a git repository', () => {
      expect(hashWorkingTree(repo)).toStrictEqual({
        ok: false,
        reason: expect.stringContaining('not a git repository'),
      });
    });

    it('refuses a repository with no commit', () => {
      git(repo, ['init', '--initial-branch=main']);

      expect(hashWorkingTree(repo)).toStrictEqual({
        ok: false,
        reason: expect.stringContaining('no commit at HEAD'),
      });
    });

    it('refuses a repository declaring submodules', () => {
      // A submodule's content lives in a repository this hash never opens, so certifying the superproject
      // alone would certify content nothing examined.
      initRepo(repo);
      fs.writeFileSync(path.join(repo, '.gitmodules'), '[submodule "vendor"]\n\tpath = vendor\n');

      expect(hashWorkingTree(repo)).toStrictEqual({
        ok: false,
        reason: expect.stringContaining('submodules'),
      });
    });

    it('refuses a tree holding an untracked nested repository', () => {
      // Git reports a nested repository as one entry and does not look inside it, so neither can the hash.
      initRepo(repo);
      const nested = path.join(repo, 'vendor');
      fs.mkdirSync(nested);
      git(nested, ['init', '--initial-branch=main']);
      fs.writeFileSync(path.join(nested, 'file.txt'), 'vendored\n');

      expect(hashWorkingTree(repo)).toStrictEqual({
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

/** Creates a disposable directory, resolved to its physical path so it compares equal to git's toplevel. */
function makeTemporaryDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-tree-hash-')));
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

// endregion | Helpers
