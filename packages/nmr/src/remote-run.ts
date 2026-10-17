import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Writable } from 'node:stream';

import { GIT_OUTPUT_LIMIT, type OutputStyle, STATUS_GLYPHS } from '@williamthorsen/nmr-core';

import { type BoundedBuffer, createBoundedBuffer } from './helpers/createBoundedBuffer.ts';
import { quoteForShell } from './helpers/quoteForShell.ts';

/** Names the host to which nmr delegates a command when the invocation does not say otherwise. */
export const DELEGATE_ENV_VAR = 'NMR_DELEGATE';

/** The flag that names the host on which to run the command. */
export const DELEGATE_FLAG = '--delegate';

/** The exit status of a delegation that failed outside its command, which matches `ssh`'s own. */
export const DELEGATION_FAILURE_EXIT_CODE = 255;

/** The flag that runs the command here, whatever `NMR_DELEGATE` names. */
export const NO_DELEGATE_FLAG = '--no-delegate';

/** Keeps `ssh` from prompting or waiting on a terminal, and bounds the wait for a host that does not answer. */
export const SSH_OPTIONS: readonly string[] = ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];

/** Where a delegation runs, or why the invocation cannot run where it asked to. */
export type DelegationTarget =
  { kind: 'local' } | { kind: 'remote'; host: string; source: 'env' | 'flag' } | { kind: 'refused'; error: string };

/** The phases of a delegation that run on the host, each reported by name when it fails. */
export type RemotePhase = 'check out' | 'install' | 'prepare' | 'push' | 'run';

/** The status of a delegated command, or the phase that kept it from finishing and what that phase printed. */
export type RemoteRunResult =
  { ok: true; exitCode: number } | { ok: false; message: string; output: string; phase: RemotePhase };

/** A commit that records the working tree, or why one could not be made. */
export type SnapshotResult =
  { ok: true; sha: string; toplevel: string } | { ok: false; isUnsupported: boolean; reason: string };

/**
 * Composes the script that runs nmr on the host, from the directory that corresponds to the local one.
 *
 * nmr runs as a job in its own process group, with stdin closed. A watcher reads the connection's stdin, which the
 * local `ssh` holds open and closes when it exits, as on Ctrl-C; on that end of input, the watcher stops nmr's whole
 * group, so that an interrupted run does not continue on the host. `--no-delegate` keeps a host whose environment
 * sets `NMR_DELEGATE` from passing the command on again.
 *
 * The script writes nmr's status to `statusPath` before it exits, so that a 255 from `ssh` can be told apart: It is
 * nmr's own when the file records it, and a dropped connection otherwise.
 *
 * @internal
 */
export function composeRunScript(options: {
  nmrArgs: readonly string[];
  remoteEnv: Readonly<Record<string, string>>;
  runDir: string;
  statusPath: string;
}): string {
  const { nmrArgs, remoteEnv, runDir, statusPath } = options;
  const assignments = Object.entries(remoteEnv).map(([name, value]) => `${name}=${quoteForShell(value)}`);
  const invocation = [...assignments, 'pnpm', 'exec', 'nmr', '--no-delegate', ...nmrArgs.map(quoteForShell)].join(' ');

  return [
    `rm -f ${statusPath}`,
    `mkdir -p ${runDir} && cd ${runDir} || exit 1`,
    'set -m',
    `${invocation} </dev/null &`,
    'nmr_pid=$!',
    '{ cat >/dev/null; kill -TERM -"$nmr_pid"; } >/dev/null 2>&1 &',
    'watcher_pid=$!',
    'set +m',
    'wait "$nmr_pid"',
    'nmr_status=$?',
    // Reap the watcher inside the redirection, so that the shell's report of its termination goes nowhere.
    '{ kill -TERM -"$watcher_pid"; wait "$watcher_pid"; } 2>/dev/null',
    String.raw`printf '%s\n' "$nmr_status" > ${statusPath}`,
    'exit "$nmr_status"',
  ].join('\n');
}

/**
 * Builds a commit whose tree is the working tree as it is on disk: tracked changes, staged or not, and untracked
 * files that git does not ignore. The commit is built in a temporary index, so the repository's index, refs, and
 * stash are untouched; the only write is to the object database.
 *
 * The identity and date are fixed, so that the same tree on the same `HEAD` always yields the same commit and a
 * repeated push transfers nothing. A submodule, or a nested repository that `git add` would record as one, is
 * refused: Its content is in a repository that the snapshot does not include.
 */
export function createSnapshot(cwd: string, env: NodeJS.ProcessEnv): SnapshotResult {
  const toplevelResult = runGit(['rev-parse', '--show-toplevel'], cwd, env);
  if (!toplevelResult.ok) {
    return { ok: false, isUnsupported: true, reason: `not a git repository: ${toplevelResult.error}` };
  }
  const toplevel = toplevelResult.stdout.trim();

  if (fs.existsSync(path.join(toplevel, '.gitmodules'))) {
    return { ok: false, isUnsupported: true, reason: 'the repository declares submodules' };
  }

  const indexPathResult = runGit(['rev-parse', '--git-path', 'index'], toplevel, env);
  if (!indexPathResult.ok) {
    return { ok: false, isUnsupported: false, reason: indexPathResult.error };
  }

  // Outside the working tree, so that `git add --all` does not record the index in itself.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-snapshot-'));
  try {
    const tempIndex = path.join(tempDir, 'index');
    const indexPath = path.resolve(toplevel, indexPathResult.stdout.trim());
    // Seeding from the real index lets git reuse its cached stat data rather than rehash every tracked file.
    if (fs.existsSync(indexPath)) {
      fs.copyFileSync(indexPath, tempIndex);
    }
    const indexEnv = { ...env, GIT_INDEX_FILE: tempIndex };

    const addResult = runGit(['add', '--all'], toplevel, indexEnv);
    if (!addResult.ok) {
      return { ok: false, isUnsupported: false, reason: addResult.error };
    }

    const stageResult = runGit(['ls-files', '--stage', '-z'], toplevel, indexEnv);
    if (!stageResult.ok) {
      return { ok: false, isUnsupported: false, reason: stageResult.error };
    }
    if (stageResult.stdout.split('\0').some((entry) => entry.startsWith('160000 '))) {
      return { ok: false, isUnsupported: true, reason: 'the working tree contains a submodule or a nested repository' };
    }

    const treeResult = runGit(['write-tree'], toplevel, indexEnv);
    if (!treeResult.ok) {
      return { ok: false, isUnsupported: false, reason: treeResult.error };
    }

    const headResult = runGit(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], toplevel, env);
    const parentArgs = headResult.ok ? ['-p', headResult.stdout.trim()] : [];
    const commitResult = runGit(
      ['commit-tree', treeResult.stdout.trim(), ...parentArgs, '-m', 'nmr delegate snapshot'],
      toplevel,
      { ...env, ...SNAPSHOT_IDENTITY_ENV },
    );
    if (!commitResult.ok) {
      return { ok: false, isUnsupported: false, reason: commitResult.error };
    }

    return { ok: true, sha: commitResult.stdout.trim(), toplevel };
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
}

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
 * Decides where an invocation runs. `--no-delegate` outranks `--delegate`, which outranks `NMR_DELEGATE`.
 *
 * A command that rewrites the tree, or that runs until it is stopped, cannot be delegated, and neither can `--log`,
 * which reads this machine's recordings. Asked for by the flag, such an invocation is refused; asked for by the
 * variable, which sets a default for every invocation, it runs here.
 */
export function resolveDelegationTarget(options: {
  command: string;
  env: NodeJS.ProcessEnv;
  flagHost: string | undefined;
  isOptedOut: boolean;
  isReading: boolean;
}): DelegationTarget {
  const { command, env, flagHost, isOptedOut, isReading } = options;
  if (isOptedOut) {
    return { kind: 'local' };
  }

  const isDelegable = !isReading && !NON_DELEGABLE_COMMANDS.has(command);

  if (flagHost !== undefined) {
    if (isDelegable) {
      return { kind: 'remote', host: flagHost, source: 'flag' };
    }
    const subject = isReading ? '--log' : `\`${command}\``;
    return {
      kind: 'refused',
      error: `${subject} cannot be delegated: it ${isReading ? "reads this machine's recordings" : 'rewrites the working tree or runs until stopped'}. Run it without ${DELEGATE_FLAG}.`,
    };
  }

  const envHost = env[DELEGATE_ENV_VAR];
  if (envHost !== undefined && envHost !== '' && isDelegable) {
    return { kind: 'remote', host: envHost, source: 'env' };
  }

  return { kind: 'local' };
}

/**
 * Runs an nmr invocation on `host` against a snapshot of the local working tree, streaming the command's output to
 * `stdout` and `stderr` and returning its exit status.
 *
 * The host keeps one checkout per local repository and host name, under `~/.cache/nmr/delegate/`, so concurrent
 * delegations from different worktrees do not share a checkout, and `node_modules` and build output persist
 * between runs. Each phase is its own connection, so that a failure names its phase; what a phase other than `run`
 * prints is returned rather than streamed, because it matters only when the phase fails.
 */
export async function runRemotely(options: {
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
  const { cwd, env, host, monorepoRoot, nmrArgs, remoteEnv, snapshot, stderr, stdout } = options;
  const checkoutPath = deriveCheckoutPath(os.hostname(), snapshot.toplevel);
  const checkoutDir = `"$HOME"/${quoteForShell(checkoutPath)}`;

  const prepare = await runSsh(
    host,
    `mkdir -p ${checkoutDir} && cd ${checkoutDir} && { [ -d .git ] || git init --quiet; }`,
    env,
  );
  if (prepare.exitCode !== 0) {
    return { ok: false, message: `could not prepare ${host}`, output: prepare.output, phase: 'prepare' };
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
    return { ok: false, message: `could not push to ${host}`, output: push.output, phase: 'push' };
  }

  const checkout = await runSsh(
    host,
    `cd ${checkoutDir} && git checkout --quiet --force --detach ${snapshot.sha} && git clean --force -d --quiet`,
    env,
  );
  if (checkout.exitCode !== 0) {
    return { ok: false, message: `could not check out on ${host}`, output: checkout.output, phase: 'check out' };
  }

  const rootDir = joinRemotePath(checkoutDir, path.relative(snapshot.toplevel, monorepoRoot));
  const install = await runSsh(host, `cd ${rootDir} && CI=true pnpm install --frozen-lockfile`, env);
  if (install.exitCode !== 0) {
    const message =
      install.exitCode === COMMAND_NOT_FOUND_EXIT_CODE
        ? `could not install on ${host}: pnpm is not on the PATH that the interactive login shell sets there`
        : `could not install on ${host}`;
    return { ok: false, message, output: install.output, phase: 'install' };
  }

  const runDir = joinRemotePath(checkoutDir, path.relative(snapshot.toplevel, cwd));
  const statusPath = `${checkoutDir}/.git/${quoteForShell(RUN_STATUS_FILE)}`;
  const run = await runProcess(
    ['ssh', ...SSH_OPTIONS, host, wrapRemoteScript(composeRunScript({ nmrArgs, remoteEnv, runDir, statusPath }))],
    {
      env,
      isStreaming: true,
      stderr,
      stdout,
    },
  );
  if (run.exitCode === DELEGATION_FAILURE_EXIT_CODE) {
    const recorded = await runSsh(host, `cat ${statusPath}`, env);
    if (recorded.exitCode !== 0 || recorded.output.trim() !== String(DELEGATION_FAILURE_EXIT_CODE)) {
      return { ok: false, message: `lost connection to ${host}`, output: '', phase: 'run' };
    }
  }

  return { ok: true, exitCode: run.exitCode };
}

/**
 * Wraps a script to run under `/bin/sh` with the `PATH` that the user's interactive login shell sets. pnpm's own
 * installer and the common version managers set it up in the interactive startup file, such as `~/.zshrc`, which a
 * non-interactive shell does not read. The script runs under `sh` rather than that shell itself, because the job
 * control on which the run script relies is not available in every login shell.
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

/** Where the run script records nmr's exit status, inside the checkout's `.git`, out of the command's sight. */
const RUN_STATUS_FILE = 'nmr-run-status';

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

/** Fixes the snapshot commit's identity and date, so that its hash depends on the tree and the parent alone. */
const SNAPSHOT_IDENTITY_ENV = {
  GIT_AUTHOR_DATE: '@0 +0000',
  GIT_AUTHOR_EMAIL: 'nmr@localhost',
  GIT_AUTHOR_NAME: 'nmr delegate',
  GIT_COMMITTER_DATE: '@0 +0000',
  GIT_COMMITTER_EMAIL: 'nmr@localhost',
  GIT_COMMITTER_NAME: 'nmr delegate',
};

/** The ref on the host to which each snapshot is pushed; it is not a branch, so a push never touches `HEAD`. */
const SNAPSHOT_REF = 'refs/nmr/delegate';

/** Writes a chunk to `stream` when there is one, and otherwise retains it in `buffer`. */
function forwardChunk(chunk: Buffer, stream: Writable | undefined, buffer: BoundedBuffer): void {
  if (stream === undefined) {
    buffer.append(chunk);
    return;
  }
  stream.write(chunk);
}

/** Joins a directory relative to the checkout onto the shell expression that names the checkout. */
function joinRemotePath(checkoutDir: string, relativeDir: string): string {
  const posixDir = relativeDir.split(path.sep).join('/');

  return posixDir === '' ? checkoutDir : `${checkoutDir}/${quoteForShell(posixDir)}`;
}

/** Runs git and returns its stdout, or the reason that it failed. */
function runGit(
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): { ok: true; stdout: string } | { ok: false; error: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env, maxBuffer: GIT_OUTPUT_LIMIT });
  if (result.error !== undefined) {
    return { ok: false, error: result.error.message };
  }
  if (result.status !== 0) {
    return { ok: false, error: result.stderr.trim() || `git ${args[0] ?? ''} exited ${result.status ?? 'abnormally'}` };
  }

  return { ok: true, stdout: result.stdout };
}

/**
 * Runs a process and returns its exit status and what it printed. A streaming run writes each chunk to the
 * streams as it arrives and holds its stdin open, which is how the host learns that the local side has gone;
 * any other run captures both streams, bounded at each end.
 */
function runProcess(
  argv: readonly string[],
  options: { cwd?: string; env: NodeJS.ProcessEnv; isStreaming?: boolean; stderr?: Writable; stdout?: Writable },
): Promise<{ exitCode: number; output: string }> {
  const { cwd, env, isStreaming = false, stderr, stdout } = options;
  const [file = '', ...args] = argv;
  const buffer = createBoundedBuffer({
    headLimitBytes: PHASE_OUTPUT_LIMIT_BYTES,
    tailLimitBytes: PHASE_OUTPUT_LIMIT_BYTES,
  });

  return new Promise((resolve) => {
    const child = spawn(file, args, { cwd, env, stdio: [isStreaming ? 'pipe' : 'ignore', 'pipe', 'pipe'] });

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

/** Runs a script on the host through `wrapRemoteScript`, capturing what it prints. */
function runSsh(host: string, script: string, env: NodeJS.ProcessEnv): Promise<{ exitCode: number; output: string }> {
  return runProcess(['ssh', ...SSH_OPTIONS, host, wrapRemoteScript(script)], { env });
}

// endregion | Helpers
