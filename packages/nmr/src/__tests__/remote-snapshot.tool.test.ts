import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { hashWorkingTree } from '@williamthorsen/nmr-core';
import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import { addSubmodule } from '../commands/test-utils/addSubmodule.ts';
import { createSnapshot } from '../remote-snapshot.ts';
import { initRepo } from '../test-utils/initRepo.ts';

describe(createSnapshot, () => {
  let workspace: TempTree;

  beforeEach(() => {
    workspace = disposeOnTestFinished(createTempTree({}, { prefix: 'nmr-snapshot-' }));
  });

  it('yields the same commit for the same tree', () => {
    workspace.writeAll({ 'repo/a.txt': 'a\n' });
    const repo = fs.realpathSync(workspace.resolve('repo'));
    initRepo(repo);
    workspace.write('repo/b.txt', 'b\n');

    const first = createSnapshot(repo, process.env);
    const second = createSnapshot(repo, process.env);

    expect(first.ok && second.ok && first.sha === second.sha).toBe(true);
  });

  it('records the tree whose id hashWorkingTree reports', () => {
    workspace.writeAll({ 'repo/a.txt': 'a\n', 'repo/b.txt': 'b\n', 'repo/dir/c.txt': 'c\n' });
    const repo = fs.realpathSync(workspace.resolve('repo'));
    initRepo(repo);
    workspace.write('repo/a.txt', 'modified\n');
    workspace.write('repo/new/d.txt', 'untracked\n');
    workspace.rm('repo/dir/c.txt');
    const treeId = requireTreeId(repo);

    const sha = requireSnapshotSha(repo);

    expect(treeId).toBe(git(repo, ['show', '--no-patch', '--format=%T', sha]).trim());
  });

  it('reports the id of the tree that it recorded', () => {
    workspace.writeAll({ 'repo/a.txt': 'a\n' });
    const repo = fs.realpathSync(workspace.resolve('repo'));
    initRepo(repo);
    workspace.write('repo/a.txt', 'modified\n');
    git(repo, ['add', 'a.txt']);
    workspace.write('repo/b.txt', 'untracked\n');

    const snapshot = createSnapshot(repo, process.env);

    expect(snapshot.ok && snapshot.treeId).toBe(requireTreeId(repo));
  });

  it('records an edit that leaves the stat data of the file as the index recorded it', () => {
    // With only whole-second mtime and size compared, git reads the file again only because its entry is not older
    // than the index file, so the copy of the index must keep the index's time.
    workspace.writeAll({ 'repo/a.txt': 'one\n' });
    const repo = fs.realpathSync(workspace.resolve('repo'));
    const file = path.join(repo, 'a.txt');
    const past = new Date('2020-01-01T00:00:00Z');
    fs.utimesSync(file, past, past);
    initRepo(repo);
    git(repo, ['config', 'core.checkStat', 'minimal']);
    git(repo, ['config', 'core.trustctime', 'false']);
    workspace.write('repo/a.txt', 'two\n');
    fs.utimesSync(file, past, past);
    fs.utimesSync(path.join(repo, '.git', 'index'), past, past);

    const result = createSnapshot(repo, process.env);

    expect(result.ok && git(repo, ['show', `${result.sha}:a.txt`])).toBe('two\n');
  });

  it('refuses a repository with a submodule', () => {
    const tree = disposeOnTestFinished(createTempTree({ 'a.txt': 'a\n' }, { prefix: 'nmr-snapshot-super-' }));
    const repo = fs.realpathSync(tree.dir);
    initRepo(repo);
    addSubmodule(tree, 'vendored');

    expect(createSnapshot(repo, process.env)).toMatchObject({ ok: false, isUnsupported: true });
  });

  it('refuses a working tree containing a nested repository', () => {
    workspace.writeAll({ 'repo/a.txt': 'a\n' });
    const repo = fs.realpathSync(workspace.resolve('repo'));
    initRepo(repo);
    workspace.write('repo/nested/b.txt', 'b\n');
    initRepo(path.join(repo, 'nested'));

    expect(createSnapshot(repo, process.env)).toMatchObject({ ok: false, isUnsupported: true });
  });
});

// region | Helpers

/** Runs git in `cwd` and returns its stdout. */
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Returns the commit that `createSnapshot` records, failing the test when it records none. */
function requireSnapshotSha(repo: string): string {
  const snapshot = createSnapshot(repo, process.env);
  if (!snapshot.ok) {
    throw new Error(`expected a snapshot, got: ${snapshot.reason}`);
  }
  return snapshot.sha;
}

/** Returns the tree id that `hashWorkingTree` reports, failing the test when it reports none. */
function requireTreeId(repo: string): string {
  const identified = hashWorkingTree(repo);
  if (!identified.ok) {
    throw new Error(`expected a tree id, got: ${identified.reason}`);
  }
  return identified.treeId;
}

// endregion | Helpers
