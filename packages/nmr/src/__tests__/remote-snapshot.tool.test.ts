import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

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
