import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, test } from 'vitest';

import type { TreeSnapshot } from '../check-cache.ts';
import { encodeTreeSnapshot, resolveTreeSnapshot, TREE_SNAPSHOT_ENV_VAR } from '../check-cache.ts';

const it = test.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-snapshot-' })),
);

describe(resolveTreeSnapshot, () => {
  it('takes the snapshot a parent process already observed', ({ tree }) => {
    // One invocation hashes the tree once; every process below it gates on that same observation.
    initRepo(tree.dir);
    const snapshot: TreeSnapshot = { hash: 'tree-hash', headSha: headShaOf(tree.dir) };

    const resolved = resolveTreeSnapshot({
      monorepoRoot: tree.dir,
      env: { [TREE_SNAPSHOT_ENV_VAR]: encodeTreeSnapshot(snapshot) },
    });

    expect(resolved).toStrictEqual({ ok: true, snapshot });
  });

  it('retakes the snapshot when HEAD has moved since the parent observed it', ({ tree }) => {
    // A process outliving the run that spawned it carries the variable with it. Gating a later invocation on
    // an observation of a tree that has since been committed over is the one way this cache wrongly skips.
    initRepo(tree.dir);
    const stale: TreeSnapshot = { hash: 'tree-hash', headSha: headShaOf(tree.dir) };
    fs.writeFileSync(path.join(tree.dir, 'src', 'index.ts'), 'export const value = 2;\n');
    commitAll(tree.dir, 'second');

    const resolved = resolveTreeSnapshot({
      monorepoRoot: tree.dir,
      env: { [TREE_SNAPSHOT_ENV_VAR]: encodeTreeSnapshot(stale) },
    });

    expect(resolved).toMatchObject({ ok: true });
    expect(resolved).not.toStrictEqual({ ok: true, snapshot: stale });
  });

  it('hashes the tree itself when no parent passed one down', ({ tree }) => {
    initRepo(tree.dir);

    expect(resolveTreeSnapshot({ monorepoRoot: tree.dir, env: {} })).toMatchObject({
      ok: true,
      snapshot: { headSha: headShaOf(tree.dir) },
    });
  });

  it('ignores a malformed inherited snapshot rather than gating on it', ({ tree }) => {
    const env = { [TREE_SNAPSHOT_ENV_VAR]: 'nonsense' };

    expect(resolveTreeSnapshot({ monorepoRoot: tree.dir, env })).toMatchObject({ ok: false });
  });

  it('refuses outside a git repository, which is what disables the gate', ({ tree }) => {
    expect(resolveTreeSnapshot({ monorepoRoot: tree.dir, env: {} })).toStrictEqual({
      ok: false,
      reason: expect.stringContaining('not a git repository'),
    });
  });

  it('refuses when the monorepo root is not the git toplevel', ({ tree }) => {
    // A repository holding the monorepo in a subdirectory has content outside it that the checks may still
    // read, and a hash covering more than the monorepo would move for edits that cannot affect it.
    initRepo(tree.dir);
    const nested = path.join(tree.dir, 'monorepo');
    fs.mkdirSync(nested, { recursive: true });

    expect(resolveTreeSnapshot({ monorepoRoot: nested, env: {} })).toStrictEqual({
      ok: false,
      reason: expect.stringContaining('not the git toplevel'),
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

/** Returns the commit HEAD names in the fixture. */
function headShaOf(repo: string): string {
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

/** Writes a committed fixture repository holding one source file. */
function initRepo(repo: string): void {
  git(repo, ['init', '--initial-branch=main']);
  git(repo, ['config', 'user.email', 'fixture@example.com']);
  git(repo, ['config', 'user.name', 'Fixture']);
  git(repo, ['config', 'commit.gpgsign', 'false']);

  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'index.ts'), 'export const value = 1;\n');
  commitAll(repo, 'initial');
}

// endregion | Helpers
