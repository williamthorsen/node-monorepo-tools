import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEBUG_ENV_VAR, NO_CACHE_ENV_VAR, TREE_SNAPSHOT_ENV_VAR } from '../../check-cache.ts';
import { RUN_IF_PRESENT_ENV_VAR } from '../../runCli.ts';
import { AGENT_ENV_VARS, COMMAND_VERBOSITY_ENV_VAR } from '../../verbosity.ts';
import { readAmbientEnv } from '../readAmbientEnv.ts';

// Every variable nmr reads out of the environment it runs in. A variable missing here is one a suite running under
// `nmr test` passes on to the runs its tests make, where it decides their outcome without being asserted on.
const STRIPPED_ENV_VARS = [
  ...AGENT_ENV_VARS,
  COMMAND_VERBOSITY_ENV_VAR,
  DEBUG_ENV_VAR,
  NO_CACHE_ENV_VAR,
  RUN_IF_PRESENT_ENV_VAR,
  TREE_SNAPSHOT_ENV_VAR,
];

describe(readAmbientEnv, () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(STRIPPED_ENV_VARS)('drops %s', (name) => {
    vi.stubEnv(name, '1');

    expect(readAmbientEnv()).not.toHaveProperty(name);
  });

  it('drops every one of them at once', () => {
    for (const name of STRIPPED_ENV_VARS) {
      vi.stubEnv(name, '1');
    }

    expect(Object.keys(readAmbientEnv()).filter((name) => STRIPPED_ENV_VARS.includes(name))).toStrictEqual([]);
  });

  it('keeps a variable nmr does not own', () => {
    vi.stubEnv('NMR_UNCLAIMED', 'kept');

    expect(readAmbientEnv()['NMR_UNCLAIMED']).toBe('kept');
  });
});
