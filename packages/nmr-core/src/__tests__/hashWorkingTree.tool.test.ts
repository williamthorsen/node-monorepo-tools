import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, describe, expect, it as baseIt, vi } from 'vitest';

import { hashWorkingTree } from '../hashWorkingTree.ts';

// Resolved to its physical path by `createTempTree`, so it compares equal to the toplevel that git reports.
// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-tree-hash-' })),
);

/** Working-tree states whose id must equal the one that `git add --all` and `git write-tree` record. */
const REFERENCE_CASES: Array<[string, (tree: TempTree) => void]> = [
  ['an untouched tree', () => {}],
  ['a modified file', (tree) => tree.write('src/index.ts', 'export const value = 2;\n')],
  [
    'a staged change',
    (tree) => {
      tree.write('src/index.ts', 'export const value = 3;\n');
      git(tree.dir, ['add', 'src/index.ts']);
    },
  ],
  [
    'a staged change reverted in the working tree',
    (tree) => {
      tree.write('src/index.ts', 'export const value = 3;\n');
      git(tree.dir, ['add', 'src/index.ts']);
      tree.write('src/index.ts', 'export const value = 1;\n');
    },
  ],
  ['an untracked file', (tree) => tree.write('src/added.ts', 'export const added = true;\n')],
  ['an untracked file in a new directory', (tree) => tree.write('new/deep/file.ts', 'deep\n')],
  ['a deleted file', (tree) => tree.rm('src/index.ts')],
  [
    'a deletion that empties a directory',
    (tree) => {
      tree.rm('src/index.ts');
      tree.rm('src/other.ts');
    },
  ],
  [
    'a directory replaced by a file',
    (tree) => {
      tree.rm('src');
      tree.write('src', 'now a file\n');
    },
  ],
  ['a rename', (tree) => git(tree.dir, ['mv', 'src/index.ts', 'src/renamed.ts'])],
  ['an added symlink', (tree) => tree.symlink('link', 'src/index.ts')],
  [
    'a repointed symlink',
    (tree) => {
      tree.symlink('link', 'src/index.ts');
      commitAll(tree.dir, 'add link');
      tree.rm('link');
      tree.symlink('link', 'src/other.ts');
    },
  ],
  ['a mode change', (tree) => fs.chmodSync(tree.resolve('src/index.ts'), 0o755)],
  ['a path containing spaces', (tree) => tree.write('a dir/a file with spaces.txt', 'spaced\n')],
  [
    'paths that `--stdin-paths` would read as a sibling unless quoted',
    (tree) => {
      tree.write('src/"other.ts"', 'quoted\n');
      tree.write('src/other.ts\r', 'carriage return\n');
      tree.write(String.raw`src/back\slash.ts`, 'backslash\n');
      tree.write('src\r/index.ts', 'directory name ending in a carriage return\n');
    },
  ],
  [
    'a directory replaced by a symlink to a directory with the same names',
    (tree) => {
      tree.writeAll({ 'elsewhere/index.ts': 'elsewhere\n', 'elsewhere/other.ts': 'elsewhere\n' });
      tree.rm('src');
      tree.symlink('src', 'elsewhere');
    },
  ],
  ['a conflicted path', (tree) => tree.write(startConflictingMerge(tree), 'resolved\n')],
  [
    'CRLF content under a `text eol=lf` attribute',
    (tree) => {
      tree.write('.gitattributes', '*.txt text eol=lf\n');
      tree.write('tracked.txt', 'one\n');
      commitAll(tree.dir, 'add attributes');
      tree.write('tracked.txt', 'one\r\ntwo\r\n');
      tree.write('untracked.txt', 'three\r\n');
    },
  ],
  [
    'an intent-to-add path',
    (tree) => {
      tree.write('src/intended.ts', 'intended\n');
      git(tree.dir, ['add', '--intent-to-add', 'src/intended.ts']);
    },
  ],
  [
    'a modified assume-unchanged entry',
    (tree) => {
      git(tree.dir, ['update-index', '--assume-unchanged', 'src/index.ts']);
      tree.write('src/index.ts', 'hidden\n');
    },
  ],
  [
    'modified and removed skip-worktree entries',
    (tree) => {
      git(tree.dir, ['update-index', '--skip-worktree', 'src/index.ts', 'src/other.ts']);
      tree.write('src/index.ts', 'hidden\n');
      tree.rm('src/other.ts');
    },
  ],
  [
    'an ignored file',
    (tree) => {
      tree.write('.gitignore', 'ignored.log\n');
      tree.write('ignored.log', 'ignored\n');
    },
  ],
];

describe(hashWorkingTree, () => {
  describe('what it reports', () => {
    it('reports the repository toplevel and HEAD commit alongside the tree id', ({ tree }) => {
      initRepo(tree);

      const result = hashWorkingTree(tree.dir);

      expect(result).toStrictEqual({
        ok: true,
        treeId: expect.stringMatching(/^[\da-f]{40}$/),
        headSha: git(tree.dir, ['rev-parse', 'HEAD']).trim(),
        toplevel: tree.dir,
      });
    });

    it('reports the same toplevel and tree id from a subdirectory', ({ tree }) => {
      initRepo(tree);
      const nested = tree.mkdir('packages/leaf');
      tree.write('packages/leaf/file.ts', 'leaf\n');

      const result = hashWorkingTree(nested);

      expect(result).toMatchObject({ ok: true, toplevel: tree.dir, treeId: referenceTreeId(tree.dir) });
    });

    it('is stable across repeated calls on an untouched tree', ({ tree }) => {
      initRepo(tree);

      expect(treeIdOf(tree.dir)).toBe(treeIdOf(tree.dir));
    });
  });

  describe('what it identifies', () => {
    it.for(REFERENCE_CASES)('records the id that `git add --all` would record for %s', ([, arrange], { tree }) => {
      initRepo(tree);
      arrange(tree);

      expect(treeIdOf(tree.dir)).toBe(referenceTreeId(tree.dir));
    });

    it('records the id that `git add --all` would record in a SHA-256 repository', ({ tree }) => {
      initRepo(tree, 'sha256');
      tree.write('src/index.ts', 'export const value = 2;\n');
      tree.write('new/file.ts', 'new\n');
      tree.symlink('link', 'src/other.ts');

      const treeId = treeIdOf(tree.dir);

      expect(treeId).toMatch(/^[\da-f]{64}$/);
      expect(treeId).toBe(referenceTreeId(tree.dir));
    });

    it('reports `HEAD^{tree}` for a clean tree', ({ tree }) => {
      initRepo(tree);

      expect(treeIdOf(tree.dir)).toBe(git(tree.dir, ['rev-parse', 'HEAD^{tree}']).trim());
    });

    it('keeps the id when the checked tree is committed', ({ tree }) => {
      initRepo(tree);
      tree.write('src/index.ts', 'export const value = 2;\n');
      tree.write('src/added.ts', 'added\n');
      const before = treeIdOf(tree.dir);

      commitAll(tree.dir, 'commit the checked tree');

      expect(treeIdOf(tree.dir)).toBe(before);
    });

    it('writes nothing to the object database or the index', ({ tree }) => {
      initRepo(tree);
      tree.write('src/index.ts', 'export const value = 2;\n');
      tree.write('new/file.ts', 'new\n');
      tree.rm('src/other.ts');
      tree.symlink('link', 'src/index.ts');
      const before = observeRepository(tree.dir);

      treeIdOf(tree.dir);

      expect(observeRepository(tree.dir)).toStrictEqual(before);
    });
  });

  describe('what moves the id', () => {
    it('leaves the id alone when a touch does not change any bytes', ({ tree }) => {
      // Timestamps are not content. An id that moved on `touch` would miss on every checkout and clone.
      initRepo(tree);
      const before = treeIdOf(tree.dir);

      const future = new Date(Date.now() + 60_000);
      fs.utimesSync(path.join(tree.dir, 'src', 'index.ts'), future, future);

      expect(treeIdOf(tree.dir)).toBe(before);
    });

    it('moves the id when a tracked file’s content changes', ({ tree }) => {
      initRepo(tree);
      const before = treeIdOf(tree.dir);

      tree.write('src/index.ts', 'export const value = 2;\n');

      expect(treeIdOf(tree.dir)).not.toBe(before);
    });

    it('moves the id when an untracked file appears', ({ tree }) => {
      initRepo(tree);
      const before = treeIdOf(tree.dir);

      tree.write('src/added.ts', 'export const added = true;\n');

      expect(treeIdOf(tree.dir)).not.toBe(before);
    });

    it('moves the id when a tracked file is deleted', ({ tree }) => {
      initRepo(tree);
      const before = treeIdOf(tree.dir);

      fs.rmSync(path.join(tree.dir, 'src', 'index.ts'));

      expect(treeIdOf(tree.dir)).not.toBe(before);
    });

    it('moves the id when a change is staged', ({ tree }) => {
      initRepo(tree);
      const before = treeIdOf(tree.dir);

      tree.write('src/index.ts', 'export const value = 3;\n');
      git(tree.dir, ['add', 'src/index.ts']);

      expect(treeIdOf(tree.dir)).not.toBe(before);
    });

    it('moves the id when a file is renamed', ({ tree }) => {
      // A staged rename is the one status record containing two paths; a parser that dropped the original path
      // would leave the file at its old path as well.
      initRepo(tree);
      const before = treeIdOf(tree.dir);

      git(tree.dir, ['mv', 'src/index.ts', 'src/renamed.ts']);

      expect(statusRecordTypes(tree.dir)).toContain('2');
      expect(treeIdOf(tree.dir)).not.toBe(before);
    });

    it('moves the id when a symlink is repointed', ({ tree }) => {
      initRepo(tree);
      tree.symlink('link', 'src/index.ts');
      const before = treeIdOf(tree.dir);

      tree.rm('link');
      tree.symlink('link', 'src/other.ts');

      expect(treeIdOf(tree.dir)).not.toBe(before);
    });

    it('moves the id when a file becomes executable', ({ tree }) => {
      initRepo(tree);
      const before = treeIdOf(tree.dir);

      fs.chmodSync(tree.resolve('src/index.ts'), 0o755);

      expect(treeIdOf(tree.dir)).not.toBe(before);
    });

    it('moves the id when a path containing spaces changes', ({ tree }) => {
      initRepo(tree);
      const spaced = 'a file with spaces.txt';
      tree.write(spaced, 'one\n');
      const before = treeIdOf(tree.dir);

      tree.write(spaced, 'two\n');

      expect(treeIdOf(tree.dir)).not.toBe(before);
    });

    it('identifies a conflicted tree by its working-tree content', ({ tree }) => {
      // An unmerged path has its own status record shape. Its working-tree content is what a check would
      // read, so it is what the id describes.
      initRepo(tree);
      const conflicted = startConflictingMerge(tree);
      expect(statusRecordTypes(tree.dir)).toContain('u');
      const before = treeIdOf(tree.dir);

      tree.write(conflicted, 'resolved\n');

      expect(treeIdOf(tree.dir)).not.toBe(before);
    });

    it('agrees across two branches with identical content', ({ tree }) => {
      // The id describes content alone, so two histories that arrive at the same content share it, which lets a
      // rebase or an amended message leave the id unchanged.
      initRepo(tree);
      const onMain = treeIdOf(tree.dir);
      git(tree.dir, ['checkout', '-b', 'other']);
      tree.write('src/index.ts', 'export const value = 9;\n');
      commitAll(tree.dir, 'diverge');
      tree.write('src/index.ts', 'export const value = 1;\n');
      commitAll(tree.dir, 'return to the original content');

      expect(treeIdOf(tree.dir)).toBe(onMain);
    });
  });

  describe('when it refuses to answer', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('refuses outside a git repository', ({ tree }) => {
      // Stop git's upward search at the fixture, so that git does not find a repository enclosing the temp root.
      vi.stubEnv('GIT_CEILING_DIRECTORIES', path.dirname(tree.dir));

      expect(hashWorkingTree(tree.dir)).toStrictEqual({
        ok: false,
        reason: expect.stringContaining('not a git repository'),
      });
    });

    it('refuses a repository without a commit', ({ tree }) => {
      git(tree.dir, ['init', '--initial-branch=main']);

      expect(hashWorkingTree(tree.dir)).toStrictEqual({
        ok: false,
        reason: expect.stringContaining('no commit at HEAD'),
      });
    });

    it('refuses a repository declaring submodules', ({ tree }) => {
      // A submodule's content is in a repository that this id never opens, so certifying the superproject alone
      // would certify content that the id did not examine.
      initRepo(tree);
      tree.write('.gitmodules', '[submodule "vendor"]\n\tpath = vendor\n');

      expect(hashWorkingTree(tree.dir)).toStrictEqual({
        ok: false,
        reason: expect.stringContaining('submodules'),
      });
    });

    it('refuses a tree containing an untracked nested repository', ({ tree }) => {
      // Because git reports a nested repository as one entry and does not look inside it, the id cannot look
      // inside it either.
      initRepo(tree);
      const nested = tree.mkdir('vendor');
      git(nested, ['init', '--initial-branch=main']);
      tree.write('vendor/file.txt', 'vendored\n');

      expect(hashWorkingTree(tree.dir)).toStrictEqual({
        ok: false,
        reason: expect.stringContaining('neither a file nor a symlink'),
      });
    });

    it('refuses a changed path containing a newline', ({ tree }) => {
      // `git hash-object --stdin-paths` reads one path per line, so it cannot hash this file.
      initRepo(tree);
      tree.write('two\nlines.txt', 'content\n');

      expect(hashWorkingTree(tree.dir)).toStrictEqual({
        ok: false,
        reason: expect.stringContaining('contains a newline'),
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
function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Writes a committed fixture repository: two source files on `main`, nothing dirty. */
function initRepo(tree: TempTree, objectFormat: 'sha1' | 'sha256' = 'sha1'): void {
  git(tree.dir, ['init', '--initial-branch=main', `--object-format=${objectFormat}`]);
  git(tree.dir, ['config', 'user.email', 'fixture@example.com']);
  git(tree.dir, ['config', 'user.name', 'Fixture']);
  git(tree.dir, ['config', 'commit.gpgsign', 'false']);

  tree.writeAll({
    'src/index.ts': 'export const value = 1;\n',
    'src/other.ts': 'export const other = 1;\n',
  });
  commitAll(tree.dir, 'initial');
}

/** Captures what a write to the repository would change: the object database's contents and the index's bytes. */
function observeRepository(repo: string): { countObjects: string; index: Buffer; objects: string[] } {
  const objectsDir = path.join(repo, '.git', 'objects');
  return {
    countObjects: git(repo, ['count-objects', '-v']),
    index: fs.readFileSync(path.join(repo, '.git', 'index')),
    objects: fs.readdirSync(objectsDir, { recursive: true, encoding: 'utf8' }).toSorted(),
  };
}

/**
 * Returns the tree id that `git add --all` into a copy of the real index followed by `git write-tree` records, the
 * way the delegation snapshot builds its tree. It writes objects, so a test calls it only after `hashWorkingTree`.
 */
function referenceTreeId(repo: string): string {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-reference-index-'));
  try {
    const index = path.join(scratch, 'index');
    const realIndex = path.resolve(repo, git(repo, ['rev-parse', '--git-path', 'index']).trim());
    fs.copyFileSync(realIndex, index);
    // Keep the index's time: A fresh one makes git trust stale stat data for an edit made in the same second.
    const { atime, mtime } = fs.statSync(realIndex);
    fs.utimesSync(index, atime, mtime);
    const env = { ...process.env, GIT_INDEX_FILE: index };
    git(repo, ['add', '--all'], env);
    return git(repo, ['write-tree'], env).trim();
  } finally {
    fs.rmSync(scratch, { force: true, recursive: true });
  }
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
 * Returns the leading character of every `--porcelain=v2` record that git currently reports, so that a test can
 * pin which record shape its fixture produces rather than assume it.
 */
function statusRecordTypes(repo: string): string[] {
  return git(repo, ['status', '--porcelain=v2', '-z', '--untracked-files=all'])
    .split('\0')
    .filter((record) => record !== '')
    .map((record) => record.slice(0, 1));
}

/** Returns the tree id, failing the test if the tree could not be identified. */
function treeIdOf(cwd: string): string {
  const result = hashWorkingTree(cwd);
  if (!result.ok) {
    throw new Error(`expected a tree id, got: ${result.reason}`);
  }
  return result.treeId;
}

// endregion | Helpers
