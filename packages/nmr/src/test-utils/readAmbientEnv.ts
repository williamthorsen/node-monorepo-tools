import process from 'node:process';

import { DEBUG_ENV_VAR, NO_CACHE_ENV_VAR, TREE_SNAPSHOT_ENV_VAR } from '../check-cache.ts';
import { COMMAND_VERBOSITY_ENV_VAR } from '../verbosity.ts';

/** The variables nmr writes into the environment of every process it spawns. */
const PROPAGATED_ENV_VARS: ReadonlySet<string> = new Set([
  COMMAND_VERBOSITY_ENV_VAR,
  DEBUG_ENV_VAR,
  NO_CACHE_ENV_VAR,
  TREE_SNAPSHOT_ENV_VAR,
]);

/**
 * Returns the environment with the variables nmr propagates to its children removed.
 *
 * A suite running under `nmr test` inherits every one of them, and each reaches the invocations the tests make:
 * a tree snapshot lets one skip on a pass the launching run recorded, and a verbosity suppresses the output an
 * assertion reads.
 */
export function readAmbientEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !PROPAGATED_ENV_VARS.has(name)));
}
