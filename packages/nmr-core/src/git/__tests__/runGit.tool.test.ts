import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, describe, expect, it as baseIt, vi } from 'vitest';

import { runGit } from '../runGit.ts';

const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-run-git-' })),
);

describe(runGit, () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('runs git in the given env', ({ tree }) => {
    expect(readGitEnvVar(tree.dir, 'NMR_PROBE', { ...process.env, NMR_PROBE: 'from-env' })).toBe('from-env');
  });

  it('does not take a variable from process.env when an env is given', ({ tree }) => {
    vi.stubEnv('NMR_PROBE', 'from-process');
    const env = { ...process.env };
    delete env['NMR_PROBE'];

    expect(readGitEnvVar(tree.dir, 'NMR_PROBE', env)).toBeUndefined();
  });

  it('runs git in process.env when no env is given', ({ tree }) => {
    vi.stubEnv('NMR_PROBE', 'from-process');

    expect(readGitEnvVar(tree.dir, 'NMR_PROBE')).toBe('from-process');
  });

  it('sets GIT_OPTIONAL_LOCKS to 0 whatever the env says', ({ tree }) => {
    expect(readGitEnvVar(tree.dir, 'GIT_OPTIONAL_LOCKS', { ...process.env, GIT_OPTIONAL_LOCKS: '1' })).toBe('0');
  });
});

// region | Helpers

/** Reads a variable as git's child shell sees it, through an alias, or returns `undefined` when it is unset. */
function readGitEnvVar(cwd: string, name: string, env?: NodeJS.ProcessEnv): string | undefined {
  const result = runGit(['-c', `alias.probe=!printenv ${name}`, 'probe'], cwd, undefined, env);
  return result.ok ? result.stdout.trim() : undefined;
}

// endregion | Helpers
