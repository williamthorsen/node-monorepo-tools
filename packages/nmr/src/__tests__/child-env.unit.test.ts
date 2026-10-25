import { describe, expect, it } from 'vitest';

import { buildChildEnv, buildRemoteEnv } from '../child-env.ts';
import { DELEGATE_ENV_VAR } from '../remote-run.ts';
import { OUTCOME_FILE_ENV_VAR } from '../stated-outcome.ts';

describe(buildChildEnv, () => {
  it.for([
    { case: 'names a host', env: { [DELEGATE_ENV_VAR]: 'box' } },
    { case: 'is unset', env: {} },
  ])('passes an empty NMR_DELEGATE when the variable $case', ({ env }) => {
    expect(build(env)).toHaveProperty(DELEGATE_ENV_VAR, '');
  });

  it('keeps a variable that it does not own', () => {
    expect(build({ HOME: '/home/me' })).toHaveProperty('HOME', '/home/me');
  });
});

describe(buildRemoteEnv, () => {
  it('does not pass NMR_DELEGATE to the host, which runs under --no-delegate', () => {
    expect(buildRemoteEnv(build({ [DELEGATE_ENV_VAR]: 'box' }))).not.toHaveProperty(DELEGATE_ENV_VAR);
  });

  it('does not pass NMR_OUTCOME_FILE to the host, whose steps are handed files of their own', () => {
    expect(buildRemoteEnv(build({ [OUTCOME_FILE_ENV_VAR]: '/tmp/outcome.json' }))).not.toHaveProperty(
      OUTCOME_FILE_ENV_VAR,
    );
  });
});

// region | Helpers

/** Builds a child environment from `env` for a plain, uncached run. */
function build(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return buildChildEnv({
    env,
    format: 'text',
    passthrough: [],
    runId: 'run',
    shouldBypassCache: false,
    shouldBypassLock: false,
    snapshot: undefined,
    styles: { stderr: 'plain', stdout: 'plain' },
    verbosity: 'full',
  });
}

// endregion | Helpers
