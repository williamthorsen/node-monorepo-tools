import process from 'node:process';

import { DEBUG_ENV_VAR, NO_CACHE_ENV_VAR, TREE_SNAPSHOT_ENV_VAR } from '../check-cache.ts';
import { RUN_IF_PRESENT_ENV_VAR } from '../runCli.ts';
import { COMMAND_VERBOSITY_ENV_VAR } from '../verbosity.ts';

/** nmr's own variables, which a suite running under nmr inherits and must not pass on to the runs it makes. */
const NMR_OWN_ENV_VARS: ReadonlySet<string> = new Set([
  COMMAND_VERBOSITY_ENV_VAR,
  DEBUG_ENV_VAR,
  NO_CACHE_ENV_VAR,
  RUN_IF_PRESENT_ENV_VAR,
  TREE_SNAPSHOT_ENV_VAR,
]);

/**
 * Returns the environment with nmr's own variables removed.
 *
 * A suite running under `nmr test` inherits every one of them, and each reaches the invocations the tests make:
 * a tree snapshot lets one skip on a pass the launching run recorded, a verbosity suppresses the output an
 * assertion reads, and a run-if-present turns an unresolvable command into the silent success an assertion on
 * `Unknown command` reads as a pass.
 */
export function readAmbientEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !NMR_OWN_ENV_VARS.has(name)));
}
