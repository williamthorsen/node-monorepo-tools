import { spawnSync } from 'node:child_process';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type ActionlintOutcome, runActionlint } from '../actionlint.ts';

const CLEAN_WORKFLOW = `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "hello"
`;

// Backticks inside single quotes are not expanded, which shellcheck reports as SC2016.
const SC2016_WORKFLOW = `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo 'built at \`date\`'
`;

describe(runActionlint, () => {
  let cacheTree: TempTree;
  let cacheRoot: string;
  let tree: TempTree;
  let output: string;

  beforeAll(() => {
    // One cache across the cases, so that the tools download once per run.
    cacheTree = createTempTree({}, { prefix: 'nmr-actionlint-remote-cache-' });
    cacheRoot = cacheTree.dir;
  });

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({}, { prefix: 'nmr-actionlint-remote-test-' }));
    // actionlint finds the project to lint by a `.git` entry at its root, as a checkout has.
    tree.write('.git/HEAD', 'ref: refs/heads/main\n');
    output = '';
  });

  afterAll(() => {
    cacheTree[Symbol.dispose]();
  });

  it('downloads the pinned tools and reports a shellcheck finding in a run block', async () => {
    tree.write('.github/workflows/build.yaml', SC2016_WORKFLOW);

    const exitCode = await runActionlint(tree.dir, [], { cacheRoot, spawn: spawnCapturing });

    expect(exitCode).toBe(1);
    expect(output).toContain('SC2016');
  });

  it('passes a workflow without findings', async () => {
    tree.write('.github/workflows/build.yaml', CLEAN_WORKFLOW);

    const exitCode = await runActionlint(tree.dir, [], { cacheRoot, spawn: spawnCapturing });

    expect(output).toBe('');
    expect(exitCode).toBe(0);
  });

  // region | Helpers

  /** Runs actionlint with its output piped into `output` rather than onto the worker's descriptors. */
  function spawnCapturing(file: string, args: string[], cwd: string): ActionlintOutcome {
    const result = spawnSync(file, ['-no-color', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });
    output = `${result.stdout}${result.stderr}`;
    return { error: result.error, signal: result.signal, status: result.status };
  }

  // endregion | Helpers
});
