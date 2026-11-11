import path from 'node:path';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished, silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runShellcheck } from '../shellcheck.ts';
import type { InheritedOutcome, SpawnInherited } from '../spawn-inherited.ts';
import type { WorkflowTool } from '../workflow-tools.ts';

describe(runShellcheck, () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({}, { prefix: 'nmr-shellcheck-test-' }));
  });

  it('passes without fetching shellcheck when the repo does not track any shell script', async () => {
    const ensure = vi.fn<(tool: WorkflowTool, cacheRoots: readonly [string, ...string[]]) => Promise<string>>();
    const spawn = vi.fn<SpawnInherited>();

    using silent = silenceConsole(['info']);
    const exitCode = await runShellcheck(tree.dir, [], { ensure, listFiles: () => [], spawn });

    expect(exitCode).toBe(0);
    expect(silent.info).toHaveBeenCalledWith(
      'No shell scripts to lint: the working tree does not contain any tracked *.sh file.',
    );
    expect(ensure).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('runs the pinned shellcheck from the root over the tracked scripts and returns its status', async () => {
    tree.write('build.sh', '#!/bin/sh\n');
    tree.write('scripts/deploy.sh', '#!/bin/sh\n');
    const ensure = vi.fn<(tool: WorkflowTool, cacheRoots: readonly [string, ...string[]]) => Promise<string>>((tool) =>
      Promise.resolve(path.join('/cache', tool)),
    );
    const spawn = vi.fn((): InheritedOutcome => ({ signal: null, status: 1 }));

    const exitCode = await runShellcheck(tree.dir, [], {
      ensure,
      listFiles: () => ['build.sh', 'scripts/deploy.sh'],
      spawn,
    });

    // The machine root depends on the developer's HOME, so only the worktree root, which is last, is asserted.
    const worktreeRoot = path.join(tree.dir, 'node_modules', '.cache', 'nmr-tools');
    expect(exitCode).toBe(1);
    expect(ensure.mock.calls.map(([tool, roots]) => [tool, roots.at(-1)])).toStrictEqual([
      ['shellcheck', worktreeRoot],
    ]);
    expect(spawn).toHaveBeenCalledWith(path.join('/cache', 'shellcheck'), ['build.sh', 'scripts/deploy.sh'], {
      cwd: tree.dir,
    });
  });

  it('skips a tracked script that is missing from the working tree', async () => {
    tree.write('kept.sh', '#!/bin/sh\n');
    const spawn = vi.fn((): InheritedOutcome => ({ signal: null, status: 0 }));

    await runShellcheck(tree.dir, [], {
      ensure: (tool) => Promise.resolve(tool),
      listFiles: () => ['deleted.sh', 'kept.sh'],
      spawn,
    });

    expect(spawn).toHaveBeenCalledWith('shellcheck', ['kept.sh'], { cwd: tree.dir });
  });

  it('passes when every tracked script is missing from the working tree', async () => {
    const spawn = vi.fn<SpawnInherited>();

    using _silent = silenceConsole(['info']);
    const exitCode = await runShellcheck(tree.dir, [], { listFiles: () => ['deleted.sh'], spawn });

    expect(exitCode).toBe(0);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('passes the invocation arguments in place of the file list', async () => {
    const listFiles = vi.fn(() => ['build.sh']);
    const spawn = vi.fn((): InheritedOutcome => ({ signal: null, status: 0 }));

    await runShellcheck(tree.dir, ['--severity=warning', 'scripts/x.sh'], {
      ensure: (tool) => Promise.resolve(tool),
      listFiles,
      spawn,
    });

    expect(listFiles).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledWith('shellcheck', ['--severity=warning', 'scripts/x.sh'], { cwd: tree.dir });
  });

  it('reports a death by signal as the shell would', async () => {
    const spawn = vi.fn((): InheritedOutcome => ({ signal: 'SIGTERM', status: null }));

    await expect(runShellcheck(tree.dir, ['x.sh'], { ensure: (tool) => Promise.resolve(tool), spawn })).resolves.toBe(
      143,
    );
  });

  it('throws when shellcheck cannot be started', async () => {
    const spawn = vi.fn((): InheritedOutcome => ({ error: new Error('spawn EACCES'), signal: null, status: null }));

    await expect(runShellcheck(tree.dir, ['x.sh'], { ensure: (tool) => Promise.resolve(tool), spawn })).rejects.toThrow(
      'Cannot run shellcheck: spawn EACCES',
    );
  });
});
