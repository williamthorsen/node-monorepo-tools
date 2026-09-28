import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEBUG_ENV_VAR, NO_CACHE_ENV_VAR, RUN_ID_ENV_VAR, TREE_SNAPSHOT_ENV_VAR } from '../../check-cache.ts';
import { OUTPUT_STYLE_ENV_VAR } from '../../output-style.ts';
import { REPORT_FORMAT_ENV_VAR } from '../../report-format.ts';
import { RUN_IF_PRESENT_ENV_VAR } from '../../runCli.ts';
import { AGENT_ENV_VARS, COMMAND_VERBOSITY_ENV_VAR } from '../../verbosity.ts';
import { readAmbientEnv } from '../readAmbientEnv.ts';

// Every variable that nmr reads out of the environment in which it runs. A variable missing here is one that a suite
// running under `nmr test` passes on to the runs that its tests make, and in those runs it decides their outcome
// without being asserted on.
const STRIPPED_ENV_VARS = [
  ...AGENT_ENV_VARS,
  COMMAND_VERBOSITY_ENV_VAR,
  DEBUG_ENV_VAR,
  NO_CACHE_ENV_VAR,
  OUTPUT_STYLE_ENV_VAR,
  REPORT_FORMAT_ENV_VAR,
  RUN_ID_ENV_VAR,
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

  it('keeps a variable that nmr does not own', () => {
    vi.stubEnv('NMR_UNCLAIMED', 'kept');

    expect(readAmbientEnv()['NMR_UNCLAIMED']).toBe('kept');
  });
});
