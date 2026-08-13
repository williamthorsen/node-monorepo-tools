import process from 'node:process';

import { DEBUG_ENV_VAR, NO_CACHE_ENV_VAR, RUN_ID_ENV_VAR, TREE_SNAPSHOT_ENV_VAR } from '../check-cache.ts';
import { REPORT_FORMAT_ENV_VAR } from '../report-format.ts';
import { RUN_IF_PRESENT_ENV_VAR } from '../runCli.ts';
import { AGENT_ENV_VARS, COMMAND_VERBOSITY_ENV_VAR } from '../verbosity.ts';

/** nmr's own variables, which a suite running under nmr inherits and must not pass on to the runs it makes. */
const NMR_OWN_ENV_VARS: readonly string[] = [
  COMMAND_VERBOSITY_ENV_VAR,
  DEBUG_ENV_VAR,
  NO_CACHE_ENV_VAR,
  REPORT_FORMAT_ENV_VAR,
  RUN_ID_ENV_VAR,
  RUN_IF_PRESENT_ENV_VAR,
  TREE_SNAPSHOT_ENV_VAR,
];

const STRIPPED_ENV_VARS: ReadonlySet<string> = new Set([...NMR_OWN_ENV_VARS, ...AGENT_ENV_VARS]);

/**
 * Returns the environment with the variables nmr reads removed.
 *
 * A suite running under `nmr test` inherits every one of nmr's own, and each reaches the invocations the tests
 * make: a tree snapshot lets one skip on a pass the launching run recorded, a verbosity suppresses the output an
 * assertion reads, a run identity makes the launching run's excerpts admissible into what a fixture records, a
 * report format turns the lines an assertion reads into JSON objects, and a run-if-present turns an unresolvable
 * command into the silent success an assertion on `Unknown command` reads as a pass.
 *
 * A harness marker does the same by a longer route: it resolves to quiet through detection, so a suite run under
 * an agent harness would suppress output that the same suite surrenders in CI. A test exercising detection sets
 * the marker on the environment it passes rather than relying on the one it inherited.
 */
export function readAmbientEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !STRIPPED_ENV_VARS.has(name)));
}
