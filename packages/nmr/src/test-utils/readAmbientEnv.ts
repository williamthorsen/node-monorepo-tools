import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { DEBUG_ENV_VAR, NO_CACHE_ENV_VAR, RUN_ID_ENV_VAR, TREE_SNAPSHOT_ENV_VAR } from '../check-cache.ts';
import { ENTRY_CHAIN_ENV_VAR } from '../entry-chain.ts';
import { RUN_IF_PRESENT_ENV_VAR } from '../invocation.ts';
import { LOCK_DIR_ENV_VAR, LOCK_TOKEN_ENV_VAR, NO_LOCK_ENV_VAR } from '../machine-lock.ts';
import { OUTPUT_STYLE_ENV_VAR } from '../output-style.ts';
import { DELEGATE_ENV_VAR } from '../remote-run.ts';
import { REPORT_FORMAT_ENV_VAR } from '../report-format.ts';
import { AGENT_ENV_VARS, COMMAND_VERBOSITY_ENV_VAR } from '../verbosity.ts';

/** nmr's own variables, which a suite running under nmr inherits and must not pass on to the runs that it makes. */
const NMR_OWN_ENV_VARS: readonly string[] = [
  COMMAND_VERBOSITY_ENV_VAR,
  DEBUG_ENV_VAR,
  DELEGATE_ENV_VAR,
  ENTRY_CHAIN_ENV_VAR,
  LOCK_DIR_ENV_VAR,
  LOCK_TOKEN_ENV_VAR,
  NO_CACHE_ENV_VAR,
  NO_LOCK_ENV_VAR,
  OUTPUT_STYLE_ENV_VAR,
  REPORT_FORMAT_ENV_VAR,
  RUN_ID_ENV_VAR,
  RUN_IF_PRESENT_ENV_VAR,
  TREE_SNAPSHOT_ENV_VAR,
];

const STRIPPED_ENV_VARS: ReadonlySet<string> = new Set([...NMR_OWN_ENV_VARS, ...AGENT_ENV_VARS]);

/**
 * Returns the environment without the variables that nmr reads, with the machine lock bypassed, and with
 * `XDG_CONFIG_HOME` naming an empty directory.
 *
 * A suite running under `nmr test` inherits nmr's own variables, and each one changes what an invocation made by
 * a test prints or decides, which makes an assertion depend on how the suite was launched. nmr detects an
 * agent-harness marker and resolves the verbosity to quiet, with the same effect. A test that exercises detection
 * sets the marker on the environment that it passes.
 *
 * The bypass keeps a test's heavy command from waiting on the `nmr test` that runs the suite, and from writing the
 * machine's real lock directory.
 *
 * The empty config home keeps the machine's user config, whose `delegate.when` would send a test's run to another
 * machine, out of every nmr that a test starts. The variable is set rather than removed, because nmr falls back to
 * `~/.config` without it.
 */
export function readAmbientEnv(): NodeJS.ProcessEnv {
  const ambientEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !STRIPPED_ENV_VARS.has(name)));

  return { ...ambientEnv, [NO_LOCK_ENV_VAR]: '1', XDG_CONFIG_HOME: resolveEmptyConfigHome() };
}

// region | Helpers

const created: { emptyConfigHome?: string } = {};

/** Returns this process's empty config home, creating it on first use and removing it when the process exits. */
function resolveEmptyConfigHome(): string {
  if (created.emptyConfigHome === undefined) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nmr-empty-config-home-'));
    process.once('exit', () => {
      rmSync(dir, { force: true, recursive: true });
    });
    created.emptyConfigHome = dir;
  }

  return created.emptyConfigHome;
}

// endregion | Helpers
