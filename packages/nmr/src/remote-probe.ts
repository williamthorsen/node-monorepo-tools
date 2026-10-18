import path from 'node:path';

import { quoteForShell } from './helpers/quoteForShell.ts';
import { isObject } from './helpers/type-guards.ts';
import { LOCK_DIR_ENV_VAR, LOCK_FILE, STALE_AFTER_MS } from './machine-lock.ts';
import { CHECKOUT_LOCK_PATH } from './remote-host-session.ts';
import { type HostProbeParams, probeHostLocks } from './remote-probe-host.ts';
import { type HostList, runSsh } from './remote-run.ts';

/** What a probe found on a host: whether a delegation started now would wait there, or that the host did not answer. */
export type ProbeResult = 'busy' | 'free' | 'no-answer';

/**
 * Probes every host at once and resolves to the one on which to run, per `selectHost`, as soon as the results that
 * have arrived settle it. Reports each result that arrives before then, and aborts the probes still running once it
 * has chosen.
 */
export function chooseHost(options: {
  hosts: HostList;
  onSettled: (host: string, result: ProbeResult) => void;
  probe: (host: string, signal: AbortSignal) => Promise<ProbeResult>;
}): Promise<string> {
  const { hosts, onSettled, probe } = options;
  const controller = new AbortController();
  const results = new Map<string, ProbeResult>();

  return new Promise((resolve) => {
    for (const host of hosts) {
      void settle(host, resolve);
    }
  });

  /** Records one host's result, and resolves when the results so far settle the choice. */
  async function settle(host: string, resolve: (chosen: string) => void): Promise<void> {
    let result: ProbeResult;
    try {
      result = await probe(host, controller.signal);
    } catch {
      result = 'no-answer';
    }
    if (controller.signal.aborted) return;

    results.set(host, result);
    onSettled(host, result);
    const chosen = selectHost(hosts, results);
    if (chosen === undefined) return;

    controller.abort();
    resolve(chosen);
  }
}

/**
 * Asks `host` whether a delegation from this checkout would wait there: whether its machine lock, or the lock of the
 * checkout at `checkoutPath`, has a live holder. A host that fails to run the probe, or does not print its report,
 * did not answer.
 */
export async function probeHost(options: {
  checkoutPath: string;
  env: NodeJS.ProcessEnv;
  host: string;
  signal: AbortSignal;
}): Promise<ProbeResult> {
  const { checkoutPath, env, host, signal } = options;
  const params: HostProbeParams = {
    checkoutLockPath: path.posix.join(checkoutPath, CHECKOUT_LOCK_PATH),
    lockDirEnvVar: LOCK_DIR_ENV_VAR,
    machineLockFile: LOCK_FILE,
    staleAfterMs: STALE_AFTER_MS,
  };
  const source = `(${probeHostLocks.toString()})(JSON.parse(process.argv[1]));`;

  const { exitCode, output } = await runSsh(
    host,
    `exec node -e ${quoteForShell(source)} ${quoteForShell(JSON.stringify(params))}`,
    env,
    signal,
  );
  if (exitCode !== 0) {
    return 'no-answer';
  }

  const busy = output
    .split('\n')
    .map(readBusyField)
    .findLast((value) => value !== undefined);
  if (busy === undefined) {
    return 'no-answer';
  }

  return busy ? 'busy' : 'free';
}

/**
 * Returns the host on which to run, or `undefined` while a host whose result could change the choice has not
 * answered: the first free host in list order, otherwise the first busy one, otherwise the first host.
 *
 * @internal
 */
export function selectHost(hosts: HostList, results: ReadonlyMap<string, ProbeResult>): string | undefined {
  for (const host of hosts) {
    const result = results.get(host);
    if (result === undefined) {
      return undefined;
    }
    if (result === 'free') {
      return host;
    }
  }

  return hosts.find((host) => results.get(host) === 'busy') ?? hosts[0];
}

// region | Helpers

/** Returns the `busy` field of a line that is the probe's report, or `undefined` for any other line. */
function readBusyField(line: string): boolean | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return isObject(value) && typeof value['busy'] === 'boolean' ? value['busy'] : undefined;
  } catch {
    return undefined;
  }
}

// endregion | Helpers
