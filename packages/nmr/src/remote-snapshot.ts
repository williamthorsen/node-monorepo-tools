import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { GIT_OUTPUT_LIMIT_BYTES } from '@williamthorsen/nmr-core';

/** A commit that records the working tree, or why one could not be made. */
export type SnapshotResult =
  { ok: true; sha: string; toplevel: string; treeId: string } | { ok: false; isUnsupported: boolean; reason: string };

/**
 * Builds a commit whose tree is the working tree as it is on disk: tracked changes, staged or not, and untracked
 * files that git does not ignore. The commit is built in a temporary index, so the repository's index, refs, and
 * stash are untouched; the only write is to the object database.
 *
 * The identity and date are fixed, so that the same tree on the same `HEAD` always yields the same commit and a
 * repeated push transfers nothing. A submodule, or a nested repository that `git add` would record as one, is
 * refused: Its content is in a repository that the snapshot does not include.
 */
export function createSnapshot(cwd: string, env: NodeJS.ProcessEnv): SnapshotResult {
  const toplevelResult = runGit(['rev-parse', '--show-toplevel'], cwd, env);
  if (!toplevelResult.ok) {
    return { ok: false, isUnsupported: true, reason: `not a git repository: ${toplevelResult.error}` };
  }
  const toplevel = toplevelResult.stdout.trim();

  if (fs.existsSync(path.join(toplevel, '.gitmodules'))) {
    return { ok: false, isUnsupported: true, reason: 'the repository declares submodules' };
  }

  const indexPathResult = runGit(['rev-parse', '--git-path', 'index'], toplevel, env);
  if (!indexPathResult.ok) {
    return { ok: false, isUnsupported: false, reason: indexPathResult.error };
  }

  // Outside the working tree, so that `git add --all` does not record the index in itself.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-snapshot-'));
  try {
    const tempIndex = path.join(tempDir, 'index');
    const indexPath = path.resolve(toplevel, indexPathResult.stdout.trim());
    // Seeding from the real index lets git reuse its cached stat data rather than rehash every tracked file.
    if (fs.existsSync(indexPath)) {
      copyIndex(indexPath, tempIndex);
    }
    const indexEnv = { ...env, GIT_INDEX_FILE: tempIndex };

    const addResult = runGit(['add', '--all'], toplevel, indexEnv);
    if (!addResult.ok) {
      return { ok: false, isUnsupported: false, reason: addResult.error };
    }

    const stageResult = runGit(['ls-files', '--stage', '-z'], toplevel, indexEnv);
    if (!stageResult.ok) {
      return { ok: false, isUnsupported: false, reason: stageResult.error };
    }
    if (stageResult.stdout.split('\0').some((entry) => entry.startsWith('160000 '))) {
      return { ok: false, isUnsupported: true, reason: 'the working tree contains a submodule or a nested repository' };
    }

    const treeResult = runGit(['write-tree'], toplevel, indexEnv);
    if (!treeResult.ok) {
      return { ok: false, isUnsupported: false, reason: treeResult.error };
    }

    const headResult = runGit(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], toplevel, env);
    const parentArgs = headResult.ok ? ['-p', headResult.stdout.trim()] : [];
    const treeId = treeResult.stdout.trim();
    const commitResult = runGit(['commit-tree', treeId, ...parentArgs, '-m', 'nmr delegate snapshot'], toplevel, {
      ...env,
      ...SNAPSHOT_IDENTITY_ENV,
    });
    if (!commitResult.ok) {
      return { ok: false, isUnsupported: false, reason: commitResult.error };
    }

    return { ok: true, sha: commitResult.stdout.trim(), toplevel, treeId };
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
}

// region | Helpers

/** Fixes the snapshot commit's identity and date, so that its hash depends on the tree and the parent alone. */
const SNAPSHOT_IDENTITY_ENV = {
  GIT_AUTHOR_DATE: '@0 +0000',
  GIT_AUTHOR_EMAIL: 'nmr@localhost',
  GIT_AUTHOR_NAME: 'nmr delegate',
  GIT_COMMITTER_DATE: '@0 +0000',
  GIT_COMMITTER_EMAIL: 'nmr@localhost',
  GIT_COMMITTER_NAME: 'nmr delegate',
};

/**
 * Copies an index and its modification time. Git trusts an entry's cached stat data only when the entry is older
 * than the index file, so a copy with a fresh time would hide an edit made in the same second as the last index
 * write. `utimesSync` rounds the time down, which can only make more entries look racy and rehashed.
 */
function copyIndex(source: string, destination: string): void {
  fs.copyFileSync(source, destination);
  const { atime, mtime } = fs.statSync(source);
  fs.utimesSync(destination, atime, mtime);
}

/** Runs git and returns its stdout, or the reason that it failed. */
function runGit(
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): { ok: true; stdout: string } | { ok: false; error: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env, maxBuffer: GIT_OUTPUT_LIMIT_BYTES });
  if (result.error !== undefined) {
    return { ok: false, error: result.error.message };
  }
  if (result.status !== 0) {
    return { ok: false, error: result.stderr.trim() || `git ${args[0] ?? ''} exited ${result.status ?? 'abnormally'}` };
  }

  return { ok: true, stdout: result.stdout };
}

// endregion | Helpers
