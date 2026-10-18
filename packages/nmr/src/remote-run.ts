import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import type { Writable } from 'node:stream';

import { type OutputStyle, STATUS_GLYPHS } from '@williamthorsen/nmr-core';

import { PASS_MANIFEST_DIR_ENV_VAR, writeDebugNote } from './check-cache.ts';
import { type BoundedBuffer, createBoundedBuffer } from './helpers/createBoundedBuffer.ts';
import { quoteForShell } from './helpers/quoteForShell.ts';
import { STALE_AFTER_MS } from './machine-lock.ts';
import { CHECKOUT_LOCK_PATH, type SessionPhase, type SessionRecord } from './remote-host-session.ts';
import { composeSessionScript, createSessionDemultiplexer, formatDelegationWaitingLine } from './remote-session.ts';

/** Names the hosts to which nmr delegates a command when the invocation does not say otherwise. */
export const DELEGATE_ENV_VAR = 'NMR_DELEGATE';

/** The flag that names the hosts on which to run the command. */
export const DELEGATE_FLAG = '--delegate';

/** The exit status of a delegation that failed outside its command, which matches `ssh`'s own. */
export const DELEGATION_FAILURE_EXIT_CODE = 255;

/** The flag that runs the command here, whatever `NMR_DELEGATE` names. */
export const NO_DELEGATE_FLAG = '--no-delegate';

/** Keeps `ssh` from prompting or waiting on a terminal, and bounds the wait for a host that does not answer. */
export const SSH_OPTIONS: readonly string[] = ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];

/** Where a delegation runs, or why the invocation cannot run where it asked to. */
export type DelegationTarget =
  { kind: 'local' } | { kind: 'remote'; hosts: HostList; source: 'env' | 'flag' } | { kind: 'refused'; error: string };

/** Candidate hosts in order of preference. */
export type HostList = readonly [string, ...string[]];

/** The phases of a delegation that run on the host, each reported by name when it fails. */
export type RemotePhase = 'check out' | 'install' | 'prepare' | 'push' | 'run';

/**
 * The status of a delegated command and the pass-manifest entries that its run reported, unvalidated, or the phase
 * that kept it from finishing and what that phase printed, with how long the delegation waited for another
 * delegation's checkout.
 */
export type RemoteRunResult =
  | { ok: true; exitCode: number; passes: unknown[]; waitedMs: number }
  | { ok: false; message: string; output: string; phase: RemotePhase; waitedMs: number };

/**
 * Returns the checkout's path on the host, relative to its home directory: a key derived from this machine and the
 * repository, followed by the repository's own directory name, which nmr on the host reports as the root's scope.
 *
 * @internal
 */
export function deriveCheckoutPath(hostname: string, toplevel: string): string {
  const key = createHash('sha256').update(`${hostname}\0${toplevel}`).digest('hex').slice(0, 16);

  return path.posix.join('.cache/nmr/delegate', key, path.basename(toplevel));
}

/**
 * Renders the warning for a `--delegate` or `--no-delegate` that appears after the command name, which makes it an
 * argument to the command rather than a flag to nmr.
 */
export function formatMisplacedDelegationWarning(command: string, style: OutputStyle): string {
  return (
    `${STATUS_GLYPHS[style].warning.text} ${DELEGATE_FLAG} and ${NO_DELEGATE_FLAG} after the command name are passed ` +
    `to \`${command}\`, not read by nmr. Did you mean \`nmr ${DELEGATE_FLAG} <host> ${command}\`?`
  );
}

/**
 * Decides where an invocation runs. `--no-delegate` outranks `--delegate`, which outranks `NMR_DELEGATE`. Each names
 * its candidate hosts as a comma-separated list, in order of preference.
 *
 * A command that rewrites the tree, or that runs until it is stopped, cannot be delegated, and neither can `--log`,
 * which reads this machine's recordings. Asked for by the flag, such an invocation is refused; asked for by the
 * variable, which sets a default for every invocation, it runs here.
 */
export function resolveDelegationTarget(options: {
  command: string;
  env: NodeJS.ProcessEnv;
  flagValue: string | undefined;
  isOptedOut: boolean;
  isReading: boolean;
}): DelegationTarget {
  const { command, env, flagValue, isOptedOut, isReading } = options;
  if (isOptedOut) {
    return { kind: 'local' };
  }

  const isDelegable = !isReading && !NON_DELEGABLE_COMMANDS.has(command);

  if (flagValue !== undefined) {
    const hosts = parseHostList(flagValue);
    if (hosts === undefined) {
      return { kind: 'refused', error: `${DELEGATE_FLAG} requires a host: "${flagValue}" does not name a host.` };
    }
    if (isDelegable) {
      return { kind: 'remote', hosts, source: 'flag' };
    }
    const subject = isReading ? '--log' : `\`${command}\``;
    return {
      kind: 'refused',
      error: `${subject} cannot be delegated: it ${isReading ? "reads this machine's recordings" : 'rewrites the working tree or runs until stopped'}. Run it without ${DELEGATE_FLAG}.`,
    };
  }

  const envHosts = parseHostList(env[DELEGATE_ENV_VAR] ?? '');
  if (envHosts !== undefined && isDelegable) {
    return { kind: 'remote', hosts: envHosts, source: 'env' };
  }

  return { kind: 'local' };
}

/**
 * Runs an nmr invocation on `host` against a snapshot of the local working tree, streaming the command's output to
 * `stdout` and `stderr` and returning its exit status.
 *
 * The host keeps one checkout per local repository and host name, under `~/.cache/nmr/delegate/`, so concurrent
 * delegations from different worktrees do not share a checkout, and `node_modules` and build output persist
 * between runs. Check out, install, and run take one connection, whose session holds the checkout's lock, so that two
 * delegations from one worktree run one after the other; what a phase other than `run` prints is returned rather than
 * streamed, because it matters only when the phase fails.
 */
export async function runRemotely(options: {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  host: string;
  monorepoRoot: string;
  nmrArgs: readonly string[];
  remoteEnv: Readonly<Record<string, string>>;
  snapshot: { sha: string; toplevel: string };
  stderr: Writable;
  stdout: Writable;
}): Promise<RemoteRunResult> {
  const { command, cwd, env, host, monorepoRoot, nmrArgs, remoteEnv, snapshot, stderr, stdout } = options;
  const checkoutPath = deriveCheckoutPath(os.hostname(), snapshot.toplevel);
  const checkoutDir = `"$HOME"/${quoteForShell(checkoutPath)}`;

  const prepare = await runSsh(
    host,
    `mkdir -p ${checkoutDir} && cd ${checkoutDir} && { [ -d .git ] || git init --quiet; }`,
    env,
  );
  if (prepare.exitCode !== 0) {
    return { ok: false, message: `could not prepare ${host}`, output: prepare.output, phase: 'prepare', waitedMs: 0 };
  }

  // `--no-verify` keeps the repository's `pre-push` hook, which may run a gate of its own, out of a push that only
  // transfers the snapshot.
  const push = await runProcess(
    [
      'git',
      'push',
      '--force',
      '--no-verify',
      '--quiet',
      `--receive-pack=${RECEIVE_PACK_COMMAND}`,
      `${host}:${checkoutPath}`,
      `${snapshot.sha}:${SNAPSHOT_REF}`,
    ],
    { cwd: snapshot.toplevel, env: { ...env, GIT_SSH_COMMAND: ['ssh', ...SSH_OPTIONS].join(' ') } },
  );
  if (push.exitCode !== 0) {
    return { ok: false, message: `could not push to ${host}`, output: push.output, phase: 'push', waitedMs: 0 };
  }

  const nonce = randomUUID();
  const marker = `__NMR_DELEGATE_${nonce}__`;
  const statusFile = `.git/nmr-run-status-${nonce}`;
  const passes: unknown[] = [];
  let waitStartedAtMs: number | undefined;
  let waitedMs = 0;
  let failure: Extract<SessionRecord, { kind: 'failed' }> | undefined;
  const demultiplexer = createSessionDemultiplexer({
    marker,
    onRecord(record) {
      if (record.kind === 'waiting') {
        waitStartedAtMs ??= Date.now();
        stderr.write(`${formatDelegationWaitingLine(record.holder, host)}\n`);
      } else if (record.kind === 'locked' && waitStartedAtMs !== undefined) {
        waitedMs = Date.now() - waitStartedAtMs;
      } else if (record.kind === 'failed') {
        failure = record;
      } else if (record.kind === 'passes') {
        passes.push(...record.entries);
      }
    },
    onMalformedRecord() {
      writeDebugNote(`discarded a malformed pass manifest from ${host}`, env, stderr);
    },
    stderr,
  });
  const script = composeSessionScript({
    checkoutDir,
    params: {
      holder: { command, dir: cwd, pid: process.pid },
      lockPath: CHECKOUT_LOCK_PATH,
      marker,
      nmrArgs,
      passManifestDir: `.git/nmr-passes-${nonce}`,
      passManifestEnvVar: PASS_MANIFEST_DIR_ENV_VAR,
      remoteEnv,
      rootDir: toRemoteRelativeDir(path.relative(snapshot.toplevel, monorepoRoot)),
      runDir: toRemoteRelativeDir(path.relative(snapshot.toplevel, cwd)),
      sha: snapshot.sha,
      staleAfterMs: STALE_AFTER_MS,
      statusFile,
    },
  });
  const session = await runProcess(['ssh', ...SSH_OPTIONS, host, wrapRemoteScript(script)], {
    env,
    isStreaming: true,
    stderr: demultiplexer.stream,
    stdout,
  });
  demultiplexer.flush();

  if (failure !== undefined) {
    const output = [demultiplexer.readOutput(), failure.output].filter((text) => text !== '').join('\n');
    return { ok: false, message: describeFailedPhase(failure, host), output, phase: failure.phase, waitedMs };
  }
  if (!demultiplexer.hasStarted()) {
    return {
      ok: false,
      message: describeUnfinishedSession(session.exitCode, host),
      output: demultiplexer.readOutput(),
      phase: 'check out',
      waitedMs,
    };
  }
  if (session.exitCode === DELEGATION_FAILURE_EXIT_CODE) {
    const recorded = await runSsh(
      host,
      `cd ${checkoutDir} && cat ${quoteForShell(statusFile)} && rm -f ${quoteForShell(statusFile)}`,
      env,
    );
    if (recorded.exitCode !== 0 || recorded.output.trim() !== String(DELEGATION_FAILURE_EXIT_CODE)) {
      return { ok: false, message: `lost connection to ${host}`, output: '', phase: 'run', waitedMs };
    }
  }

  return { ok: true, exitCode: session.exitCode, passes, waitedMs };
}

/**
 * Runs a script on the host through `wrapRemoteScript`, capturing what it prints. An abort stops the `ssh` process.
 */
export function runSsh(
  host: string,
  script: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<{ exitCode: number; output: string }> {
  return runProcess(['ssh', ...SSH_OPTIONS, host, wrapRemoteScript(script)], { env, signal });
}

/**
 * Wraps a script to run under `/bin/sh` with the `PATH` that the user's interactive login shell sets. pnpm's own
 * installer and the common version managers set it up in the interactive startup file, such as `~/.zshrc`, which a
 * non-interactive shell does not read. The script runs under `sh` rather than that shell itself, because the login
 * shell, such as fish, may not accept the POSIX syntax in which the scripts are written.
 *
 * A startup file may print to stdout, so the shell prints `PATH` after a marker, and only what follows the last
 * marker is read. When no marker arrives, the script keeps the `PATH` with which `ssh` started it.
 *
 * @internal
 */
export function wrapRemoteScript(script: string): string {
  return `exec /bin/sh -c ${quoteForShell(`${LOGIN_PATH_PREAMBLE}\n${script}`)}`;
}

// region | Helpers

/** Precedes the `PATH` that the interactive login shell prints, apart from anything that its startup files print. */
const PATH_MARKER = '__NMR_LOGIN_PATH__=';

/** Sets `PATH` to the one that the interactive login shell sets, per `wrapRemoteScript`. */
const LOGIN_PATH_PREAMBLE = [
  `nmr_login_path=$("\${SHELL:-/bin/sh}" -ilc 'printf "\\n${PATH_MARKER}%s\\n" "$PATH"' </dev/null 2>/dev/null | sed -n 's/^${PATH_MARKER}//p' | tail -n 1)`,
  '[ -n "$nmr_login_path" ] && PATH=$nmr_login_path',
  'export PATH',
].join('; ');

/**
 * Runs git's receiving end on the host under the `PATH` that the other phases use. git appends the repository's
 * path to this command, which the script receives as `$1`.
 */
const RECEIVE_PACK_COMMAND = `/bin/sh -c ${quoteForShell(`${LOGIN_PATH_PREAMBLE}; exec git receive-pack "$1"`)} nmr-receive-pack`;

/** The status with which a shell reports a command that it could not find. */
const COMMAND_NOT_FOUND_EXIT_CODE = 127;

/** Bounds each end of a phase's captured output. */
const PHASE_OUTPUT_LIMIT_BYTES = 65_536;

/** Commands that rewrite the working tree or run until stopped, which a delegation could not report back. */
const NON_DELEGABLE_BASE_COMMANDS = ['build', 'clean', 'compile', 'fix', 'fmt', 'lint', 'test:watch', 'upgrade'];

const NON_DELEGABLE_COMMANDS: ReadonlySet<string> = new Set([
  ...NON_DELEGABLE_BASE_COMMANDS,
  ...NON_DELEGABLE_BASE_COMMANDS.map((command) => `root:${command}`),
]);

/** The ref on the host to which each snapshot is pushed; it is not a branch, so a push never touches `HEAD`. */
const SNAPSHOT_REF = 'refs/nmr/delegate';

/** Names the phase that the host session reported as failed. */
function describeFailedPhase(failure: { exitCode: number; phase: SessionPhase }, host: string): string {
  if (failure.phase === 'check out') {
    return `could not check out on ${host}`;
  }

  return failure.exitCode === COMMAND_NOT_FOUND_EXIT_CODE
    ? `could not install on ${host}: pnpm is not on the PATH that the interactive login shell sets there`
    : `could not install on ${host}`;
}

/** Describes a host session that ended before it reported the run's start or a failed phase. */
function describeUnfinishedSession(exitCode: number, host: string): string {
  if (exitCode === COMMAND_NOT_FOUND_EXIT_CODE) {
    return `could not check out on ${host}: node is not on the PATH that the interactive login shell sets there`;
  }

  return exitCode === DELEGATION_FAILURE_EXIT_CODE ? `lost connection to ${host}` : `could not check out on ${host}`;
}

/** Writes a chunk to `stream` when there is one, and otherwise retains it in `buffer`. */
function forwardChunk(chunk: Buffer, stream: Writable | undefined, buffer: BoundedBuffer): void {
  if (stream === undefined) {
    buffer.append(chunk);
    return;
  }
  stream.write(chunk);
}

/**
 * Splits a comma-separated host list, dropping whitespace, empty entries, and repeats. Returns `undefined` when the
 * value does not name a host.
 */
function parseHostList(value: string): HostList | undefined {
  const names = value.split(',').map((host) => host.trim());
  const [first, ...rest] = new Set(names.filter((host) => host !== ''));

  return first === undefined ? undefined : [first, ...rest];
}

/**
 * Runs a process and returns its exit status and what it printed. A streaming run writes each chunk to the
 * streams as it arrives and holds its stdin open, which is how the host learns that the local side has gone;
 * any other run captures both streams, bounded at each end. An abort of `signal` kills the process.
 */
function runProcess(
  argv: readonly string[],
  options: {
    cwd?: string;
    env: NodeJS.ProcessEnv;
    isStreaming?: boolean;
    signal?: AbortSignal | undefined;
    stderr?: Writable;
    stdout?: Writable;
  },
): Promise<{ exitCode: number; output: string }> {
  const { cwd, env, isStreaming = false, signal, stderr, stdout } = options;
  const [file = '', ...args] = argv;
  const buffer = createBoundedBuffer({
    headLimitBytes: PHASE_OUTPUT_LIMIT_BYTES,
    tailLimitBytes: PHASE_OUTPUT_LIMIT_BYTES,
  });

  return new Promise((resolve) => {
    const child = spawn(file, args, { cwd, env, signal, stdio: [isStreaming ? 'pipe' : 'ignore', 'pipe', 'pipe'] });

    child.stdout?.on('data', (chunk: Buffer) => {
      forwardChunk(chunk, isStreaming ? stdout : undefined, buffer);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      forwardChunk(chunk, isStreaming ? stderr : undefined, buffer);
    });

    child.on('error', (error) => {
      resolve({ exitCode: COMMAND_NOT_FOUND_EXIT_CODE, output: `${file}: ${error.message}` });
    });
    child.on('close', (code, signal) => {
      child.stdin?.destroy();
      resolve({
        exitCode: code ?? 128 + (signal === null ? 0 : os.constants.signals[signal]),
        output: buffer.readBuffer().toString('utf8'),
      });
    });
  });
}

/** Renders a directory relative to the checkout in the form that the host session resolves. */
function toRemoteRelativeDir(relativeDir: string): string {
  return relativeDir === '' ? '.' : relativeDir.split(path.sep).join('/');
}

// endregion | Helpers
