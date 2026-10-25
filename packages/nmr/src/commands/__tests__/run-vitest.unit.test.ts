import { spawnSync } from 'node:child_process';
import os from 'node:os';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { OUTCOME_FILE_ENV_VAR } from '../../stated-outcome.ts';
import { chooseVitestConfigArgs, runNmrVitest } from '../run-vitest.ts';

// Stands in for a Vitest child that the OOM killer ended.
vi.mock(import('node:child_process'), async (importOriginal) => ({
  ...(await importOriginal()),
  // An untyped mock, because one implementation cannot satisfy every `spawnSync` overload.
  spawnSync: vi.fn().mockReturnValue({ error: undefined, signal: 'SIGKILL', status: null }),
}));

const WORKSPACE_FILES = {
  'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
  'packages/a/package.json': '{}\n',
};

describe(chooseVitestConfigArgs, () => {
  it('names the root vitest.config when the package does not have a config', () => {
    using tree = createTempTree({ ...WORKSPACE_FILES, 'vitest.config.ts': '' }, { prefix: 'nmr-vitest-' });

    expect(chooseVitestConfigArgs(['run'], tree.resolve('packages/a'))).toStrictEqual([
      '--config',
      tree.resolve('vitest.config.ts'),
      'run',
    ]);
  });

  it('tries the extensions in the order that Vitest does', () => {
    using tree = createTempTree(
      { ...WORKSPACE_FILES, 'vitest.config.js': '', 'vitest.config.mts': '' },
      { prefix: 'nmr-vitest-' },
    );

    expect(chooseVitestConfigArgs([], tree.resolve('packages/a'))).toStrictEqual([
      '--config',
      tree.resolve('vitest.config.mts'),
    ]);
  });

  it.each(['vitest.config.ts', 'vite.config.mjs'])('leaves the arguments alone when the package has a %s', (file) => {
    using tree = createTempTree(
      { ...WORKSPACE_FILES, 'vitest.config.ts': '', [`packages/a/${file}`]: '' },
      { prefix: 'nmr-vitest-' },
    );

    expect(chooseVitestConfigArgs(['run'], tree.resolve('packages/a'))).toStrictEqual(['run']);
  });

  it.each([['--config', 'other.ts'], ['--config=other.ts'], ['-c', 'other.ts']])(
    'leaves an explicit %s alone',
    (...configArgs) => {
      using tree = createTempTree({ ...WORKSPACE_FILES, 'vitest.config.ts': '' }, { prefix: 'nmr-vitest-' });
      const argv = ['run', ...configArgs];

      expect(chooseVitestConfigArgs(argv, tree.resolve('packages/a'))).toStrictEqual(argv);
    },
  );

  it('names the root config when a config flag follows `--`', () => {
    using tree = createTempTree({ ...WORKSPACE_FILES, 'vitest.config.ts': '' }, { prefix: 'nmr-vitest-' });

    expect(chooseVitestConfigArgs(['run', '--', '-c'], tree.resolve('packages/a'))).toStrictEqual([
      '--config',
      tree.resolve('vitest.config.ts'),
      'run',
      '--',
      '-c',
    ]);
  });

  it('does not name a root vite.config, which only a vitest.config stands for', () => {
    using tree = createTempTree({ ...WORKSPACE_FILES, 'vite.config.ts': '' }, { prefix: 'nmr-vitest-' });

    expect(chooseVitestConfigArgs(['run'], tree.resolve('packages/a'))).toStrictEqual(['run']);
  });

  it('leaves the arguments alone at a monorepo root without a config', () => {
    using tree = createTempTree(WORKSPACE_FILES, { prefix: 'nmr-vitest-' });

    expect(chooseVitestConfigArgs(['run'], tree.dir)).toStrictEqual(['run']);
  });

  it('leaves the arguments alone outside any monorepo', () => {
    using tree = createTempTree({ 'package.json': '{}\n' }, { prefix: 'nmr-vitest-' });

    expect(chooseVitestConfigArgs(['run'], tree.dir)).toStrictEqual(['run']);
  });
});

describe(runNmrVitest, () => {
  it('reports a Vitest killed by a signal as 128 plus the signal number', () => {
    expect(runNmrVitest(['run'], import.meta.dirname)).toBe(128 + os.constants.signals.SIGKILL);
  });

  it('does not pass NMR_OUTCOME_FILE to the suite, whose tests are not the step that nmr handed it to', () => {
    vi.stubEnv(OUTCOME_FILE_ENV_VAR, '/tmp/outcome.json');
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });

    runNmrVitest(['run'], import.meta.dirname);

    expect(vi.mocked(spawnSync).mock.lastCall?.[2]?.env).not.toHaveProperty(OUTCOME_FILE_ENV_VAR);
  });
});
