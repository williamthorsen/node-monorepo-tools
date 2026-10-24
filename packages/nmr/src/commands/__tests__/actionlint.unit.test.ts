import path from 'node:path';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished, silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ActionlintOutcome, buildActionlintArgs, runActionlint } from '../actionlint.ts';
import type { WorkflowTool } from '../workflow-tools.ts';

describe(runActionlint, () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({}, { prefix: 'nmr-actionlint-test-' }));
  });

  it('passes without fetching any tool when the repo does not have a workflows directory', async () => {
    const ensure = vi.fn<(tool: WorkflowTool, cacheRoot: string) => Promise<string>>();
    const spawn = vi.fn<(file: string, args: string[], cwd: string) => ActionlintOutcome>();

    using silent = silenceConsole(['info']);
    const exitCode = await runActionlint(tree.dir, [], { ensure, spawn });

    expect(exitCode).toBe(0);
    expect(silent.info).toHaveBeenCalledWith('No workflows to lint: .github/workflows/ does not exist.');
    expect(ensure).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('runs the pinned actionlint from the root with the pinned shellcheck and returns its status', async () => {
    tree.write('.github/workflows/ci.yaml', 'on: push\n');
    const ensure = vi.fn((tool: WorkflowTool, cacheRoot: string) => Promise.resolve(path.join(cacheRoot, tool)));
    const spawn = vi.fn((): ActionlintOutcome => ({ signal: null, status: 1 }));

    const exitCode = await runActionlint(tree.dir, ['.github/workflows/ci.yaml'], { ensure, spawn });

    const cacheRoot = path.join(tree.dir, 'node_modules', '.cache', 'nmr-tools');
    expect(exitCode).toBe(1);
    expect(ensure.mock.calls).toStrictEqual([
      ['actionlint', cacheRoot],
      ['shellcheck', cacheRoot],
    ]);
    expect(spawn).toHaveBeenCalledWith(
      path.join(cacheRoot, 'actionlint'),
      [`-shellcheck=${path.join(cacheRoot, 'shellcheck')}`, '-pyflakes=', '.github/workflows/ci.yaml'],
      tree.dir,
    );
  });

  it('reports a death by signal as the shell would', async () => {
    tree.write('.github/workflows/ci.yaml', 'on: push\n');
    const ensure = vi.fn((tool: WorkflowTool) => Promise.resolve(tool));
    const spawn = vi.fn((): ActionlintOutcome => ({ signal: 'SIGTERM', status: null }));

    await expect(runActionlint(tree.dir, [], { ensure, spawn })).resolves.toBe(143);
  });

  it('throws when actionlint cannot be started', async () => {
    tree.write('.github/workflows/ci.yaml', 'on: push\n');
    const ensure = vi.fn((tool: WorkflowTool) => Promise.resolve(tool));
    const spawn = vi.fn((): ActionlintOutcome => ({ error: new Error('spawn EACCES'), signal: null, status: null }));

    await expect(runActionlint(tree.dir, [], { ensure, spawn })).rejects.toThrow('Cannot run actionlint: spawn EACCES');
  });
});

describe(buildActionlintArgs, () => {
  it('passes shellcheck by path, disables pyflakes, and appends the invocation arguments', () => {
    expect(buildActionlintArgs('/cache/shellcheck', ['-oneline'])).toStrictEqual([
      '-shellcheck=/cache/shellcheck',
      '-pyflakes=',
      '-oneline',
    ]);
  });
});
