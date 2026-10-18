import os from 'node:os';
import { Writable } from 'node:stream';

import { reportError } from '@williamthorsen/nmr-core';

import { NO_CACHE_ENV_VAR, resolveRunId, writeDebugNote } from './check-cache.ts';
import { buildChildEnv, buildRemoteEnv } from './child-env.ts';
import { resolveDelegationTarget } from './delegation-target.ts';
import { type BoundedBuffer, createBoundedBuffer } from './helpers/createBoundedBuffer.ts';
import type { ExecutionTarget, Invocation, PhaseResult, RunCliResult, RunPlan } from './invocation.ts';
import { isDelegationFlag, type ParsedArgs } from './invocation-args.ts';
import { reportVerdict } from './presentation.ts';
import { chooseHost, probeHost, type ProbeResult } from './remote-probe.ts';
import {
  DELEGATE_ENV_VAR,
  DELEGATE_FLAG,
  DELEGATE_TO_FLAG,
  DELEGATION_FAILURE_EXIT_CODE,
  deriveCheckoutPath,
  formatMisplacedDelegationWarning,
  type HostList,
  NO_DELEGATE_FLAG,
  runRemotely,
} from './remote-run.ts';
import { createSnapshot } from './remote-snapshot.ts';
import type { RetainedOutput } from './runner.ts';
import { formatDisplayPath, loadUserConfig } from './user-config.ts';
import type { VerdictOutcome } from './verdict.ts';

/** How a run on the host ended, or that the invocation runs here after all. */
export type HostRunResult =
  | { kind: 'here' }
  | { kind: 'refused'; exitCode: number }
  | {
      kind: 'ran';
      durationMs: number;
      exitCode: number;
      host: string;
      outcome: VerdictOutcome;
      /** The host's pass-manifest entries, unvalidated, empty when the run did not complete or its host sent none. */
      passes: unknown[];
      retainedOutput: RetainedOutput;
      /** The tree that was pushed, absent when the working tree could not be snapshotted. */
      treeId: string | undefined;
    };

/**
 * Decides where the invocation runs, warning about a delegation flag that the command will receive as an argument.
 * Settles an invocation whose delegation is refused.
 */
export async function resolveExecutionTarget(invocation: Invocation): Promise<PhaseResult<ExecutionTarget>> {
  const { command, context, env, parsedArgs, stderr, styles } = invocation;

  // A delegation flag past the command name is an argument to the command, so the command runs wherever the flags
  // before it say. Without this warning, the developer would believe that it ran elsewhere.
  if (parsedArgs.passthrough.some(isDelegationFlag)) {
    stderr.write(`${formatMisplacedDelegationWarning(command, styles.stderr)}\n`);
  }

  const target = await resolveDelegationTarget({
    command,
    env,
    extraAgentEnvVars: context.config.output?.extraAgentEnvVars,
    flagValue: parsedArgs.delegateHosts,
    isFanOut: parsedArgs.filter !== undefined || parsedArgs.recursive,
    isOptedOut: parsedArgs.shouldRunLocally,
    isReading: parsedArgs.shouldPrintLog,
    isRepoOptedOut: context.config.delegate === false,
    readUserConfig: () => loadUserConfig(env),
    shouldDelegate: parsedArgs.shouldDelegate,
  });
  if (target.kind === 'refused') {
    reportError(target.error, stderr);
    return { settled: true, result: { exitCode: 1 } };
  }
  if (target.kind === 'remote') {
    writeDebugNote(`delegating ${command} per ${describeDelegationSource(target, parsedArgs, env)}`, env, stderr);
  }

  return { settled: false, value: target };
}

/**
 * Runs the whole invocation on the host and reports one verdict for it, its connection, transfer, and install
 * included. Returns `undefined` when the invocation runs here after all.
 *
 * Serves a `-F` or `-R` invocation, which does not have a gate of its own to consult first: the host fans it out.
 */
export async function runInvocationOnHost(
  invocation: Invocation,
  target: RemoteTarget,
): Promise<RunCliResult | undefined> {
  const { env, format, parsedArgs, styles } = invocation;
  const childEnv = buildChildEnv({
    env,
    format,
    passthrough: parsedArgs.passthrough,
    runId: resolveRunId(env),
    shouldBypassCache: parsedArgs.shouldBypassCache || env[NO_CACHE_ENV_VAR] === '1',
    shouldBypassLock: parsedArgs.shouldBypassLock,
    snapshot: undefined,
    styles,
    verbosity: invocation.verbosity,
  });

  const result = await delegate({ invocation, remoteEnv: buildRemoteEnv(childEnv), target });
  if (result.kind === 'here') {
    return undefined;
  }
  if (result.kind === 'ran') {
    reportVerdict(
      { command: invocation.command, host: result.host, scope: invocation.scope, ...result.outcome },
      invocation.stdout,
      format,
      styles.stdout,
    );
  }

  return { exitCode: result.exitCode };
}

/**
 * Runs a plan's command on the host, once the gate has found no pass to recall. Returns what the run produced, its
 * output included so that a pass can be recorded with its transcript, and leaves the verdict to the caller.
 */
export async function runPlanOnHost(plan: RunPlan, target: RemoteTarget): Promise<HostRunResult> {
  return delegate({
    invocation: plan.invocation,
    remoteEnv: buildRemoteEnv(plan.runOptions.env ?? plan.invocation.env),
    target,
  });
}

// region | Helpers

/** A target that names its candidate hosts. */
type RemoteTarget = Extract<ExecutionTarget, { kind: 'remote' }>;

/** Describes a probe's result for a debug note. */
const PROBE_RESULT_PHRASES: Readonly<Record<ProbeResult, string>> = {
  busy: 'is busy',
  free: 'is free',
  'no-answer': 'did not answer the lock probe',
};

/**
 * Returns the arguments with which the host runs the invocation: nmr's own flags that decide what runs and how it
 * reports, then the command and its arguments. The output style travels in the environment instead, resolved for
 * this terminal rather than for the host's pipe.
 */
function composeForwardedArgs(command: string, parsedArgs: ParsedArgs): string[] {
  return [
    ...(parsedArgs.filter === undefined ? [] : ['--filter', parsedArgs.filter]),
    ...(parsedArgs.recursive ? ['--recursive'] : []),
    ...(parsedArgs.isWorkspaceRoot ? ['--workspace-root'] : []),
    ...(parsedArgs.quiet ? ['--quiet'] : []),
    ...(parsedArgs.shouldEmitJson ? ['--json'] : []),
    ...(parsedArgs.shouldBypassCache ? ['--no-cache'] : []),
    ...(parsedArgs.shouldBypassLock ? ['--no-lock'] : []),
    command,
    ...parsedArgs.passthrough,
  ];
}

/** Returns a stream that writes each chunk to `stream` and retains a copy of it in `buffer`. */
function createTee(stream: Writable, buffer: BoundedBuffer): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      buffer.append(chunk);
      stream.write(chunk);
      callback();
    },
  });
}

/** Names what sent the invocation to a host, for a debug note. */
function describeDelegationSource(target: RemoteTarget, parsedArgs: ParsedArgs, env: NodeJS.ProcessEnv): string {
  switch (target.source) {
    case 'config':
      return `${formatDisplayPath(target.configPath, env)} (when: ${target.when})`;
    case 'env':
      return DELEGATE_ENV_VAR;
    case 'flag':
      return parsedArgs.delegateHosts === undefined ? DELEGATE_FLAG : DELEGATE_TO_FLAG;
  }
}

/**
 * Runs the invocation on the host that `resolveHost` chooses, against a snapshot of the working tree, streaming its
 * output and retaining a copy.
 *
 * A tree that cannot be snapshotted is refused when the flag asked for the host, and runs here, with a line saying
 * why, when the variable did. A delegation that fails outside its command, in its connection, transfer, or install,
 * ends with exit 255, and what the failed phase printed goes to stderr.
 */
async function delegate(options: {
  invocation: Invocation;
  remoteEnv: Readonly<Record<string, string>>;
  target: RemoteTarget;
}): Promise<HostRunResult> {
  const { invocation, remoteEnv, target } = options;
  const { command, context, cwd, env, parsedArgs, stderr, stdout } = invocation;
  const listedHosts = target.hosts.join(', ');

  const startedAtMs = Date.now();
  const snapshot = createSnapshot(cwd, env);
  if (!snapshot.ok && snapshot.isUnsupported) {
    if (target.source === 'flag') {
      reportError(`Cannot delegate to ${listedHosts}: ${snapshot.reason}`, stderr);
      return { kind: 'refused', exitCode: 1 };
    }
    stderr.write(`nmr: running ${command} here rather than on ${listedHosts}: ${snapshot.reason}\n`);
    return { kind: 'here' };
  }

  const host = snapshot.ok ? await resolveHost(target.hosts, snapshot.toplevel, env, stderr) : target.hosts[0];

  const retained = { stderr: createBoundedBuffer(), stdout: createBoundedBuffer() };
  const result = snapshot.ok
    ? await runRemotely({
        command,
        cwd,
        env,
        host,
        monorepoRoot: context.monorepoRoot,
        nmrArgs: composeForwardedArgs(command, parsedArgs),
        remoteEnv,
        snapshot,
        stderr: createTee(stderr, retained.stderr),
        stdout: createTee(stdout, retained.stdout),
      })
    : { ok: false as const, message: 'could not snapshot the working tree', output: snapshot.reason, waitedMs: 0 };
  const durationMs = Date.now() - startedAtMs - result.waitedMs;
  const ran = {
    kind: 'ran' as const,
    durationMs,
    host,
    retainedOutput: { stderr: retained.stderr.readBuffer(), stdout: retained.stdout.readBuffer() },
    treeId: snapshot.ok ? snapshot.treeId : undefined,
  };

  if (!result.ok) {
    if (result.output.trim() !== '') {
      stderr.write(result.output.endsWith('\n') ? result.output : `${result.output}\n`);
    }
    // A host that does not answer fails at `prepare`, which is where a sandbox that refuses `ssh` stops the run.
    if (target.source === 'config' && 'phase' in result && result.phase === 'prepare') {
      const configPath = formatDisplayPath(target.configPath, env);
      stderr.write(
        `nmr: ${configPath} sent ${command} to ${listedHosts}; ask for network access to ${listedHosts}, ` +
          `or run it here with nmr ${NO_DELEGATE_FLAG} ${command}\n`,
      );
    }
    return {
      ...ran,
      exitCode: DELEGATION_FAILURE_EXIT_CODE,
      passes: [],
      outcome: { outcome: 'failed', detail: result.message, durationMs, exitCode: DELEGATION_FAILURE_EXIT_CODE },
    };
  }

  const outcome: VerdictOutcome =
    result.exitCode === 0
      ? { outcome: 'passed', durationMs }
      : { outcome: 'failed', durationMs, exitCode: result.exitCode };

  return { ...ran, exitCode: result.exitCode, outcome, passes: result.passes };
}

/**
 * Returns the host on which to run: the only candidate, or the one that `chooseHost` picks by probing the locks that
 * a delegation from this checkout would wait on.
 */
async function resolveHost(
  hosts: HostList,
  toplevel: string,
  env: NodeJS.ProcessEnv,
  stderr: Writable,
): Promise<string> {
  const [first, ...rest] = hosts;
  if (rest.length === 0) {
    return first;
  }

  const checkoutPath = deriveCheckoutPath(os.hostname(), toplevel);
  return chooseHost({
    hosts,
    onSettled(host, result) {
      writeDebugNote(`${host} ${PROBE_RESULT_PHRASES[result]}`, env, stderr);
    },
    probe: (host, signal) => probeHost({ checkoutPath, env, host, signal }),
  });
}

// endregion | Helpers
