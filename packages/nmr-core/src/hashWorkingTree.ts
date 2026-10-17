import { existsSync, lstatSync, readlinkSync } from 'node:fs';
import path from 'node:path';

import { describeError } from '@williamthorsen/toolbelt.errors';

import { collectChangedPaths } from './collectChangedPaths.ts';
import {
  type GitObjectFormat,
  type GitTreeEntry,
  hashGitObject,
  parseObjectFormat,
  parseTreeObject,
  serializeTreeObject,
  TREE_MODE,
} from './gitObjects.ts';
import { hasErrnoCode } from './hasErrnoCode.ts';
import { runGit, runGitForBytes } from './runGit.ts';

/**
 * The git tree id of a working tree, or the reason one could not be produced. For every degraded condition (no
 * repository, no commit, a git failure, a tree that this id cannot describe), the result is `ok: false` rather than
 * an id on which a caller might act.
 */
export type WorkingTreeHashResult =
  { ok: true; treeId: string; headSha: string; toplevel: string } | { ok: false; reason: string };

/**
 * Identifies the entire working tree at `cwd` by its git tree id: the id that `git add --all` into a fresh copy of
 * the index followed by `git write-tree` would record. Two trees with the same content share an id, so a `touch`
 * that does not change any bytes leaves it unchanged, while any edit, addition, deletion, or mode change moves it. A
 * clean tree's id is `HEAD^{tree}`, and a commit that records the tree as it is leaves the id unchanged.
 *
 * The id is computed in memory rather than with `write-tree`: A hash is an observation, and a repository must look
 * exactly the same after taking one, so nothing here writes to the object database or the index. Reading git's own
 * status keeps the running time proportional to what has changed rather than to the size of the repository: Only
 * the trees on the path from a changed entry to the root are read from `HEAD` and hashed again.
 *
 * Content passes through git's clean filters as `git add` applies them. Configuration that makes `git add` record
 * something other than what is on disk, such as `core.fileMode=false` or `core.symlinks=false`, is not modeled.
 */
export function hashWorkingTree(cwd: string): WorkingTreeHashResult {
  const toplevelResult = runGit(['rev-parse', '--show-toplevel'], cwd);
  if (!toplevelResult.ok) {
    return { ok: false, reason: `not a git repository: ${toplevelResult.error}` };
  }
  const toplevel = toplevelResult.stdout.trim();
  if (toplevel === '') {
    return { ok: false, reason: 'git did not report a repository toplevel' };
  }

  // A submodule's content is in a repository into which this hash never looks, so a tree containing one is a tree
  // that this hash cannot describe.
  if (existsSync(path.join(toplevel, '.gitmodules'))) {
    return { ok: false, reason: 'the repository declares submodules, whose content this hash does not cover' };
  }

  const revisionResult = runGit(['rev-parse', '--show-object-format', 'HEAD', 'HEAD^{tree}'], cwd);
  if (!revisionResult.ok) {
    return { ok: false, reason: `no commit at HEAD: ${revisionResult.error}` };
  }
  const [formatName, headSha, headTreeId] = revisionResult.stdout.trim().split('\n', 3);
  if (formatName === undefined || headSha === undefined || headTreeId === undefined) {
    return { ok: false, reason: 'git did not report an object format, a HEAD commit, and a tree' };
  }
  const format = parseObjectFormat(formatName);
  if (format === undefined) {
    return { ok: false, reason: `unsupported object format: ${formatName}` };
  }

  // `--untracked-files=all` lists untracked files individually; the default collapses a directory to one entry,
  // whose contents would then go unhashed.
  const statusResult = runGit(['status', '--porcelain=v2', '-z', '--untracked-files=all'], cwd);
  if (!statusResult.ok) {
    return { ok: false, reason: `git status failed: ${statusResult.error}` };
  }

  const pathsResult = collectChangedPaths(statusResult.stdout);
  if (!pathsResult.ok) {
    return pathsResult;
  }
  if (pathsResult.paths.size === 0) {
    return { ok: true, treeId: headTreeId, headSha, toplevel };
  }

  const changesResult = readChangedEntries(toplevel, pathsResult.paths, format);
  if (!changesResult.ok) {
    return changesResult;
  }

  const treeResult = buildTreeId({ changes: changesResult.changes, format, headSha, headTreeId, toplevel });
  if (!treeResult.ok) {
    return treeResult;
  }

  return { ok: true, treeId: treeResult.treeId, headSha, toplevel };
}

/**
 * Returns the commit that `HEAD` names, or `undefined` when git cannot say. Because it is cheap next to a full
 * hash, a caller that has observed a tree can check whether `HEAD` still names the same commit without hashing the
 * tree again.
 */
export function readHeadSha(cwd: string): string | undefined {
  const result = runGit(['rev-parse', 'HEAD'], cwd);
  if (!result.ok) {
    return undefined;
  }

  const headSha = result.stdout.trim();
  return headSha === '' ? undefined : headSha;
}

// region | Helpers

/**
 * The entry that each changed path now has, keyed by its path from the toplevel as `latin1` bytes, or `undefined`
 * for a path that is no longer on disk.
 */
type ChangedEntries = Map<string, Omit<GitTreeEntry, 'name'> | undefined>;

type ChangedEntriesResult = { ok: true; changes: ChangedEntries } | { ok: false; reason: string };

type HeadTreesResult = { ok: true; trees: Map<string, Map<string, GitTreeEntry>> } | { ok: false; reason: string };

/** What a changed path turned out to be on disk; a regular file's blob id is computed later, with git's filters. */
type PathState =
  | { ok: true; kind: 'absent' }
  | { ok: true; kind: 'file'; mode: string }
  | { ok: true; kind: 'link'; id: Buffer }
  | { ok: false; reason: string };

/**
 * Applies the changed entries to `HEAD`'s tree and returns the id of the resulting root tree. Only the directories
 * containing a change, and their ancestors, are read and hashed again; every other subtree keeps its id from `HEAD`.
 */
function buildTreeId(options: {
  changes: ChangedEntries;
  format: GitObjectFormat;
  headSha: string;
  headTreeId: string;
  toplevel: string;
}): { ok: true; treeId: string } | { ok: false; reason: string } {
  const { changes, format, headSha, headTreeId, toplevel } = options;

  const directories = new Set<string>();
  for (const changedPath of changes.keys()) {
    for (let directory = splitPath(changedPath).parent; ; directory = splitPath(directory).parent) {
      directories.add(directory);
      if (directory === '') {
        break;
      }
    }
  }

  const treesResult = readHeadTrees({ directories, format, headSha, headTreeId, toplevel });
  if (!treesResult.ok) {
    return treesResult;
  }
  const { trees } = treesResult;

  for (const [changedPath, entry] of changes) {
    const { name, parent } = splitPath(changedPath);
    const tree = entriesAt(trees, parent);
    if (entry === undefined) {
      tree.delete(name);
    } else {
      tree.set(name, { ...entry, name });
    }
  }

  // Deepest first, so that each directory's subtrees are final before its own entry is hashed.
  const deepestFirst = [...directories].toSorted((left, right) => depthOf(right) - depthOf(left));
  for (const directory of deepestFirst) {
    if (directory === '') {
      continue;
    }
    const { name, parent } = splitPath(directory);
    const parentTree = entriesAt(trees, parent);
    const tree = entriesAt(trees, directory);
    // Git does not record an empty directory. A file that replaced the directory is already in `parentTree`.
    if (tree.size === 0) {
      if (parentTree.get(name)?.mode === TREE_MODE) {
        parentTree.delete(name);
      }
      continue;
    }
    parentTree.set(name, {
      id: hashGitObject(format, 'tree', serializeTreeObject(tree.values())),
      mode: TREE_MODE,
      name,
    });
  }

  const rootId = hashGitObject(format, 'tree', serializeTreeObject(entriesAt(trees, '').values()));
  return { ok: true, treeId: rootId.toString('hex') };
}

/** Returns the number of directories that contain a path from the toplevel; the root itself has depth 0. */
function depthOf(directory: string): number {
  return directory === '' ? 0 : directory.split('/').length;
}

/** Returns the entries of `directory`, adding an empty set for a directory not yet seen. */
function entriesAt(trees: Map<string, Map<string, GitTreeEntry>>, directory: string): Map<string, GitTreeEntry> {
  let entries = trees.get(directory);
  if (entries === undefined) {
    entries = new Map();
    trees.set(directory, entries);
  }
  return entries;
}

/** Reports whether a directory that contains `relativePath`, below the toplevel, is a symlink. */
function hasSymlinkLeadingPath(toplevel: string, relativePath: string): boolean {
  const segments = relativePath.split('/').slice(0, -1);
  return segments.some((_segment, index) => {
    try {
      return lstatSync(path.join(toplevel, ...segments.slice(0, index + 1))).isSymbolicLink();
    } catch {
      // A missing leading directory is reported by the `lstat` of the path itself.
      return false;
    }
  });
}

/**
 * Renders a path in the C-quoted form that `git hash-object --stdin-paths` unquotes: double-quoted, with `"`, `\`,
 * and control characters escaped.
 */
function quotePath(relativePath: string): string {
  let quoted = '"';
  for (const character of relativePath) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (character === '"' || character === '\\') {
      quoted += `\\${character}`;
    } else if (codePoint < 0x20 || codePoint === 0x7f) {
      quoted += `\\${codePoint.toString(8).padStart(3, '0')}`;
    } else {
      quoted += character;
    }
  }
  return `${quoted}"`;
}

/**
 * Determines the entry that each changed path now has. A regular file's blob id comes from one
 * `git hash-object --stdin-paths` call, which applies clean filters and line-ending conversion as `git add` does
 * without writing the blob. A symlink's id is computed here, because `hash-object` reads through the link.
 */
function readChangedEntries(toplevel: string, paths: Set<string>, format: GitObjectFormat): ChangedEntriesResult {
  const changes: ChangedEntries = new Map();
  const regularFiles: Array<{ key: string; mode: string; relativePath: string }> = [];

  for (const relativePath of paths) {
    // `git cat-file --batch` echoes a missing name on a newline-terminated line, and a path that git could not
    // render as UTF-8 cannot be found again.
    if (relativePath.includes('\n') || relativePath.includes('\u{FFFD}')) {
      return {
        ok: false,
        reason: `${JSON.stringify(relativePath)} contains a newline or bytes that are not UTF-8, so it is not hashable`,
      };
    }

    const key = Buffer.from(relativePath, 'utf8').toString('latin1');
    const state = readPathState(toplevel, relativePath, format);
    if (!state.ok) {
      return state;
    }
    switch (state.kind) {
      case 'absent':
        changes.set(key, undefined);
        break;
      case 'file':
        regularFiles.push({ key, mode: state.mode, relativePath });
        break;
      case 'link':
        changes.set(key, { id: state.id, mode: '120000' });
        break;
    }
  }

  if (regularFiles.length === 0) {
    return { ok: true, changes };
  }

  // `--stdin-paths` reads a line that starts with `"` as C-quoted and drops a trailing `\r`, so every path is quoted.
  const input = regularFiles.map((file) => `${quotePath(file.relativePath)}\n`).join('');
  const hashResult = runGit(['hash-object', '--stdin-paths'], toplevel, input);
  if (!hashResult.ok) {
    return { ok: false, reason: `git hash-object failed: ${hashResult.error}` };
  }
  const ids = hashResult.stdout.split('\n').filter((line) => line !== '');
  if (ids.length !== regularFiles.length) {
    return { ok: false, reason: `git hash-object reported ${ids.length} ids for ${regularFiles.length} paths` };
  }
  for (const [index, file] of regularFiles.entries()) {
    changes.set(file.key, { id: Buffer.from(ids[index] ?? '', 'hex'), mode: file.mode });
  }

  return { ok: true, changes };
}

/**
 * Reads the entries that `HEAD` records for each directory, through one `git cat-file --batch` call. A directory
 * that `HEAD` does not contain as a tree has no entries.
 */
function readHeadTrees(options: {
  directories: Set<string>;
  format: GitObjectFormat;
  headSha: string;
  headTreeId: string;
  toplevel: string;
}): HeadTreesResult {
  const { directories, format, headSha, headTreeId, toplevel } = options;
  const ordered = [...directories];
  const input = ordered
    .map((directory) => (directory === '' ? `${headTreeId}\0` : `${headSha}:${directory}\0`))
    .join('');

  const batchResult = runGitForBytes(['cat-file', '--batch', '-z'], toplevel, Buffer.from(input, 'latin1'));
  if (!batchResult.ok) {
    return { ok: false, reason: `git cat-file failed: ${batchResult.error}` };
  }
  const output = batchResult.stdout;
  const malformed: HeadTreesResult = { ok: false, reason: 'git cat-file reported a malformed object' };

  const trees = new Map<string, Map<string, GitTreeEntry>>();
  let offset = 0;
  for (const directory of ordered) {
    const lineEnd = output.indexOf(0x0a, offset);
    if (lineEnd === -1) {
      return malformed;
    }
    const header = output.toString('latin1', offset, lineEnd);
    offset = lineEnd + 1;
    if (header.endsWith(' missing')) {
      trees.set(directory, new Map());
      continue;
    }

    const [, type, sizeText] = header.split(' ', 3);
    if (sizeText === undefined) {
      return malformed;
    }
    const size = Number(sizeText);
    if (!Number.isSafeInteger(size) || offset + size > output.length) {
      return malformed;
    }
    const content = output.subarray(offset, offset + size);
    offset += size + 1;

    const entries = type === 'tree' ? parseTreeObject(format, content) : [];
    if (entries === undefined) {
      return malformed;
    }
    trees.set(directory, new Map(entries.map((entry) => [entry.name, entry])));
  }

  return { ok: true, trees };
}

/**
 * Reports what one changed path is on disk. A path that git named but that is no longer on disk is absent, which is
 * what removes it from the tree. A path that exists but cannot be read, or that is neither a file nor a symlink,
 * fails closed: A partial id would certify content that it did not examine.
 */
function readPathState(toplevel: string, relativePath: string, format: GitObjectFormat): PathState {
  const absolutePath = path.join(toplevel, relativePath);
  // Git does not follow a symlinked directory, so a path beneath one is not in the working tree.
  if (hasSymlinkLeadingPath(toplevel, relativePath)) {
    return { ok: true, kind: 'absent' };
  }

  let stats;
  try {
    stats = lstatSync(absolutePath);
  } catch (error: unknown) {
    // `ENOTDIR` reports a path whose parent directory was replaced by a file.
    if (hasErrnoCode(error, 'ENOENT') || hasErrnoCode(error, 'ENOTDIR')) {
      return { ok: true, kind: 'absent' };
    }
    return { ok: false, reason: `could not stat ${relativePath}: ${describeError(error)}` };
  }

  if (stats.isFile()) {
    return { ok: true, kind: 'file', mode: (stats.mode & 0o100) === 0 ? '100644' : '100755' };
  }
  if (stats.isSymbolicLink()) {
    try {
      // A symlink's content is the path that it names, which is also what git records for it.
      const target = readlinkSync(absolutePath, { encoding: 'buffer' });
      return { ok: true, kind: 'link', id: hashGitObject(format, 'blob', target) };
    } catch (error: unknown) {
      return { ok: false, reason: `could not read ${relativePath}: ${describeError(error)}` };
    }
  }

  // A directory here is an untracked repository, which git reports as a single entry and does not look inside.
  return { ok: false, reason: `${relativePath} is neither a file nor a symlink, so its content is not hashable` };
}

/** Splits a path from the toplevel into its containing directory (`''` for the root) and its last segment. */
function splitPath(fullPath: string): { name: string; parent: string } {
  const separator = fullPath.lastIndexOf('/');
  return separator === -1
    ? { name: fullPath, parent: '' }
    : { name: fullPath.slice(separator + 1), parent: fullPath.slice(0, separator) };
}

// endregion | Helpers
