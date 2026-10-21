import path from 'node:path';

import { quoteForShell } from './helpers/quoteForShell.ts';
import { isObject } from './helpers/type-guards.ts';
import { LOCK_DIR_ENV_VAR, LOCK_FILE, STALE_AFTER_MS } from './machine-lock.ts';
import { CHECKOUT_LOCK_PATH } from './remote-host-session.ts';
import { type HostProbeParams, probeHostLocks } from './remote-probe-host.ts';
import { DELEGATION_FAILURE_EXIT_CODE, type HostList, readLastLine, runSsh } from './remote-run.ts';

/**
 * The host on which to run, or that `ssh` could not connect to any host, with what it printed for the first one
 * listed.
 */
export type HostChoice = { kind: 'chosen'; host: string } | { kind: 'unreachable'; host: string; sshMessage: string };

/**
 * The host that the probe results settle on, or that every host is unreachable.
 *
 * @internal
 */
export type HostSelection = { kind: 'chosen'; host: string } | { kind: 'unreachable' };

/** What a probe found, with the last line that `ssh` printed when it could not connect. */
export interface ProbeReport {
  result: ProbeResult;
  sshMessage: string;
}

/**
 * What a probe found on a host: whether a delegation started now would wait there, that the host connected but did
 * not answer, or that `ssh` could not connect to it.
 */
export type ProbeResult = 'busy' | 'free' | 'no-answer' | 'unreachable';

/**
 * Probes every host at once and resolves to the one on which to run, per `selectHost`, as soon as the results that
 * have arrived settle it. Reports each result that arrives before then, and aborts the probes still running once it
 * has chosen.
 */
export function chooseHost(options: {
  hosts: HostList;
  onSettled: (host: string, result: ProbeResult) => void;
  probe: (host: string, signal: AbortSignal) => Promise<ProbeReport>;
}): Promise<HostChoice> {
  const { hosts, onSettled, probe } = options;
  const controller = new AbortController();
  const results = new Map<string, ProbeResult>();
  const sshMessages = new Map<string, string>();

  return new Promise((resolve) => {
    for (const host of hosts) {
      void settle(host, resolve);
    }
  });

  /** Records one host's result, and resolves when the results so far settle the choice. */
  async function settle(host: string, resolve: (choice: HostChoice) => void): Promise<void> {
    let report: ProbeReport;
    try {
      report = await probe(host, controller.signal);
    } catch {
      report = { result: 'no-answer', sshMessage: '' };
    }
    if (controller.signal.aborted) return;

    results.set(host, report.result);
    sshMessages.set(host, report.sshMessage);
    onSettled(host, report.result);
    const selection = selectHost(hosts, results);
    if (selection === undefined) return;

    controller.abort();
    const [first] = hosts;
    resolve(
      selection.kind === 'chosen'
        ? selection
        : { kind: 'unreachable', host: first, sshMessage: sshMessages.get(first) ?? '' },
    );
  }
}

/**
 * Asks `host` whether a delegation from this checkout would wait there: whether its machine lock, or the lock of the
 * checkout at `checkoutPath`, has a live holder. A host to which `ssh` cannot connect is unreachable, and one that
 * fails to run the probe, or does not print its report, did not answer.
 */
export async function probeHost(options: {
  checkoutPath: string;
  env: NodeJS.ProcessEnv;
  host: string;
  signal: AbortSignal;
}): Promise<ProbeReport> {
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
  if (exitCode === DELEGATION_FAILURE_EXIT_CODE) {
    return { result: 'unreachable', sshMessage: readLastLine(output) };
  }
  if (exitCode !== 0) {
    return { result: 'no-answer', sshMessage: '' };
  }

  const busy = output
    .split('\n')
    .map(readBusyField)
    .findLast((value) => value !== undefined);
  if (busy === undefined) {
    return { result: 'no-answer', sshMessage: '' };
  }

  return { result: busy ? 'busy' : 'free', sshMessage: '' };
}

/**
 * Returns the host on which to run, or `undefined` while a host whose result could change the choice has not
 * answered: the first free host in list order, otherwise the first busy one, otherwise the first one that connected.
 * When `ssh` could not connect to any host, returns that every host is unreachable.
 *
 * @internal
 */
export function selectHost(hosts: HostList, results: ReadonlyMap<string, ProbeResult>): HostSelection | undefined {
  for (const host of hosts) {
    const result = results.get(host);
    if (result === undefined) {
      return undefined;
    }
    if (result === 'free') {
      return { kind: 'chosen', host };
    }
  }

  const host =
    hosts.find((candidate) => results.get(candidate) === 'busy') ??
    hosts.find((candidate) => results.get(candidate) === 'no-answer');

  return host === undefined ? { kind: 'unreachable' } : { kind: 'chosen', host };
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
