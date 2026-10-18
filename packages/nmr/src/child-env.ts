import type { StreamStyles } from '@williamthorsen/nmr-core';

import {
  DEBUG_ENV_VAR,
  encodeTreeSnapshot,
  NO_CACHE_ENV_VAR,
  RUN_ID_ENV_VAR,
  TREE_SNAPSHOT_ENV_VAR,
  type TreeSnapshot,
} from './check-cache.ts';
import type { Invocation } from './invocation.ts';
import {
  acquireMachineLock,
  formatMisplacedNoLockWarning,
  HEAVY_COMMANDS,
  LOCK_TOKEN_ENV_VAR,
  type MachineLock,
  NO_LOCK_ENV_VAR,
} from './machine-lock.ts';
import { OUTPUT_STYLE_ENV_VAR } from './output-style.ts';
import { DELEGATE_ENV_VAR } from './remote-run.ts';
import { REPORT_FORMAT_ENV_VAR, type ReportFormat } from './report-format.ts';
import { COMMAND_VERBOSITY_ENV_VAR, type CommandVerbosity } from './verbosity.ts';

/**
 * Returns the environment that tells the processes below this one what the lock came to: They run under its hold,
 * or, when the chain runs unlocked, they skip the lock.
 */
export function addLockEnv(env: NodeJS.ProcessEnv, lock: MachineLock | undefined): NodeJS.ProcessEnv {
  if (lock?.token !== undefined) {
    return { ...env, [LOCK_TOKEN_ENV_VAR]: lock.token };
  }
  if (lock?.isChainUnlocked === true) {
    return { ...env, [NO_LOCK_ENV_VAR]: '1' };
  }

  return env;
}

/**
 * Builds the environment that every process below this one inherits. The snapshot travels down to make a chain
 * of nmr invocations gate on one observation of the tree; a bypass, to cover the whole chain rather than only the
 * command next to which it was typed; the verbosity, to make each process suppress the output of the command
 * that it runs rather than of the subtree beneath it; and the run's identity, to mark the excerpts that a run
 * records at every scope as one run's.
 *
 * The verbosity is written in both modes, so that a chain's loudness is decided once at the top rather than
 * re-derived at every link from an environment that a caller may have set.
 *
 * Trailing arguments bypass the cache for the whole chain, as `--no-cache` does. `openGate` disables this
 * invocation's own gate for them, but the steps below it are separate nmr invocations that do not receive any
 * arguments of their own, and without the bypass a narrowed command would serve part of its work from a recorded
 * pass.
 *
 * `NMR_DELEGATE` is set empty: a command that runs here runs its whole chain here, so that a step or a `-F`/`-R`
 * child of a local run passes itself on neither to the host that the variable names nor to the user config's.
 *
 * The style written down is the resolved one and never `auto`: a child on a pipe renders as this process does
 * rather than detecting plain on its own descriptor. It is the style to which stdout resolved: the verdicts and
 * nearly every other line that a child prints go there.
 */
export function buildChildEnv(options: {
  env: NodeJS.ProcessEnv;
  format: ReportFormat;
  passthrough: readonly string[];
  runId: string;
  shouldBypassCache: boolean;
  shouldBypassLock: boolean;
  snapshot: TreeSnapshot | undefined;
  styles: StreamStyles;
  verbosity: CommandVerbosity;
}): NodeJS.ProcessEnv {
  const { env, format, passthrough, runId, shouldBypassCache, shouldBypassLock, snapshot, styles, verbosity } = options;

  const bypassesCache = shouldBypassCache || passthrough.length > 0;
  return {
    ...env,
    [DELEGATE_ENV_VAR]: '',
    ...(snapshot !== undefined && { [TREE_SNAPSHOT_ENV_VAR]: encodeTreeSnapshot(snapshot) }),
    ...(bypassesCache && { [NO_CACHE_ENV_VAR]: '1' }),
    ...(shouldBypassLock && { [NO_LOCK_ENV_VAR]: '1' }),
    [COMMAND_VERBOSITY_ENV_VAR]: verbosity,
    [OUTPUT_STYLE_ENV_VAR]: styles.stdout,
    [REPORT_FORMAT_ENV_VAR]: format,
    [RUN_ID_ENV_VAR]: runId,
  };
}

/**
 * Returns the variables of a child environment that the host's nmr receives: those that decide how it reports, whether
 * it bypasses its cache, whether it writes debug notes, and which run it belongs to. The rest describe this machine,
 * such as the tree snapshot and the lock token, or would disable the host's lock on the strength of a local
 * workaround, as an inherited `NMR_NO_LOCK` would; the `--no-lock` flag still reaches the host as an argument.
 */
export function buildRemoteEnv(childEnv: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    REMOTE_ENV_VARS.flatMap((name) => {
      const value = childEnv[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

/**
 * Takes the machine lock for a heavy command that runs, or returns `undefined` for any other invocation. A delegated
 * `--log` reads recordings and runs nothing. A `--no-lock` written after the command name is an argument to the
 * command, so it is reported rather than read.
 */
export async function takeMachineLock(invocation: Invocation): Promise<MachineLock | undefined> {
  const { anchorDir, command, env, parsedArgs, stderr, styles } = invocation;
  if (!HEAVY_COMMANDS.has(command) || parsedArgs.shouldPrintLog) {
    return undefined;
  }

  if (parsedArgs.passthrough.includes('--no-lock')) {
    stderr.write(`${formatMisplacedNoLockWarning(command, styles.stderr)}\n`);
  }

  return acquireMachineLock({
    command,
    dir: anchorDir,
    env: parsedArgs.shouldBypassLock ? { ...env, [NO_LOCK_ENV_VAR]: '1' } : env,
    stderr,
  });
}

// region | Helpers

/** The variables that `buildRemoteEnv` passes to the host, named one by one so that a new variable stays here. */
const REMOTE_ENV_VARS: readonly string[] = [
  COMMAND_VERBOSITY_ENV_VAR,
  DEBUG_ENV_VAR,
  NO_CACHE_ENV_VAR,
  OUTPUT_STYLE_ENV_VAR,
  REPORT_FORMAT_ENV_VAR,
  RUN_ID_ENV_VAR,
];

// endregion | Helpers
