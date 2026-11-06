import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished, silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import { initRepo } from '../../test-utils/initRepo.ts';
import { listTrackedScripts, runShellcheck, type ShellcheckOutcome } from '../shellcheck.ts';

describe(runShellcheck, () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({}, { prefix: 'nmr-shellcheck-tool-test-' }));
  });

  it('passes in a repo that does not track any shell script', async () => {
    tree.write('README.md', '# fixture\n');
    initRepo(tree.dir);

    using silent = silenceConsole(['info']);
    const exitCode = await runShellcheck(tree.dir, [], { ensure: () => Promise.reject(new Error('not expected')) });

    expect(exitCode).toBe(0);
    expect(silent.info).toHaveBeenCalledOnce();
  });

  it("runs shellcheck over the repo's tracked scripts, nested ones included, and returns its status", async () => {
    tree.write('build.sh', '#!/bin/sh\n');
    tree.write('scripts/deep/deploy.sh', '#!/bin/sh\n');
    tree.write('notes.txt', 'not a script\n');
    initRepo(tree.dir);
    tree.write('untracked.sh', '#!/bin/sh\n');
    const calls: string[][] = [];

    const exitCode = await runShellcheck(tree.dir, [], {
      ensure: () => Promise.resolve('shellcheck'),
      spawn: (_file, args): ShellcheckOutcome => {
        calls.push(args);
        return { signal: null, status: 1 };
      },
    });

    expect(exitCode).toBe(1);
    expect(calls).toStrictEqual([['build.sh', 'scripts/deep/deploy.sh']]);
  });
});

describe(listTrackedScripts, () => {
  it('throws when the directory is not a git work tree', () => {
    using tree = createTempTree({}, { prefix: 'nmr-shellcheck-tool-test-' });

    expect(() => listTrackedScripts(tree.dir)).toThrow('Cannot list tracked shell scripts');
  });
});
