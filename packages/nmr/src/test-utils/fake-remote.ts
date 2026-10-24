import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import type { TempTree } from '@williamthorsen/toolbelt.testing/candidate';

import { quoteForShell } from '../helpers/quoteForShell.ts';
import { SSH_COMMAND_ENV_VAR } from '../remote-run.ts';
import { readAmbientEnv } from './readAmbientEnv.ts';

/** A host simulated on this machine: an `ssh` and a `pnpm` that run the host's side locally, and their logs. */
export interface FakeRemote {
  /** Gives `host` a home of its own, in place of the shared one, and returns it. */
  addHost: (host: string) => string;
  /**
   * Creates an ssh wrapper that logs each call's arguments and runs the fake `ssh`, and returns a `GIT_SSH_COMMAND`
   * that names it through shell quoting, with an option whose value contains a space.
   */
  addSshWrapper: () => { command: string; readLog: () => string[] };
  /**
   * Returns an environment in which `ssh` and `pnpm` resolve to the fakes, without the ambient `GIT_SSH_COMMAND`,
   * which would send the fake host's calls through the real ssh.
   */
  buildEnv: (extraEnv?: Record<string, string>) => NodeJS.ProcessEnv;
  /** The directory that stands for the host's home. */
  home: string;
  /** Reads what the fake `pnpm` logged, one entry per line. */
  readPnpmLog: () => string[];
  /** Reads the calls that the fake `ssh` received, one `<host> probe` or `<host> other` per line. */
  readSshLog: () => string[];
}

/**
 * Creates a fake host under `tree`. The fake `ssh` logs each call, then runs its command with `/bin/sh` in the host's
 * home: the shared fake home, or the one that `addHost` gave the host. A host whose name starts with `unreachable`
 * fails as `ssh` does, and one named `dropping` runs the host session with its stdout discarded and then exits 255, as
 * `ssh` does when the connection drops during the run. The fake login shell prints a greeting, as a startup file may,
 * and drops `-il`, so that a profile on this machine cannot reorder `PATH` ahead of the fakes. The fake `ssh` unsets
 * every `NMR_*` variable, as `ssh` forwards none of the local environment, and then sets `NMR_LOCK_DIR` to the
 * directory `nmr-lock` in the host's home, so that each host has a machine lock of its own.
 *
 * The fake `pnpm` logs each call. Its `install` logs, as `state=present` or `state=absent`, whether pnpm's workspace
 * state file exists, then writes that file as pnpm does; with `FAKE_INSTALL_REAL` naming a pnpm, it runs that pnpm
 * instead. Its `exec` logs the directory, the arguments, the output style, nmr's own variables, the files in the
 * directory, the bins in its `node_modules/.bin`, and the content of `probe.txt` when there is one, then prints to both
 * streams. These variables steer it: `FAKE_INSTALL_STATUS` and `FAKE_RUN_STATUS` set exit statuses;
 * `FAKE_INSTALL_SLEEP` and `FAKE_RUN_SLEEP` make the install or the run write its pid to `FAKE_INSTALL_PIDFILE` or
 * `FAKE_RUN_PIDFILE` and sleep; `FAKE_INSTALL_NOISE` makes the install print that many lines and then
 * `last install line`; `FAKE_RUN_MANIFEST`, a JSON array, makes the run write each element as an entry file into the
 * pass manifest; and `FAKE_RUN_TERM_DELAY` makes the run take that many seconds to exit on `SIGTERM`.
 */
export function createFakeRemote(tree: TempTree): FakeRemote {
  const binDir = tree.mkdir('fake-bin');
  const home = tree.mkdir('fake-home');
  const pnpmLog = tree.resolve('pnpm.log');
  const sshLog = tree.resolve('ssh.log');

  writeExecutable(tree, 'fake-bin/login-shell', [
    '#!/bin/sh',
    'if [ "$1" = -ilc ]; then shift; echo "Loading startup files..."; exec /bin/sh -c "$@"; fi',
    'exec /bin/sh "$@"',
  ]);
  writeExecutable(tree, 'fake-bin/ssh', [
    '#!/bin/sh',
    'while [ $# -gt 0 ]; do',
    '  case "$1" in',
    '    -o|-p|-i|-l|-F|-J) shift 2 ;;',
    '    -*) shift ;;',
    '    *) break ;;',
    '  esac',
    'done',
    'host=$1; shift',
    'cmd="$*"',
    'case "$cmd" in *probeHostLocks*) echo "$host probe" ;; *) echo "$host other" ;; esac >> "$FAKE_SSH_LOG"',
    'case "$host" in unreachable*) echo "ssh: connect to host $host: Connection refused" >&2; exit 255 ;; esac',
    // `ssh` forwards none of the local environment, so nmr's own variables reach the host only through the session.
    String.raw`for name in $(env | sed -n 's/^\(NMR_[A-Z_]*\)=.*/\1/p'); do unset "$name"; done`,
    '[ -d "$FAKE_REMOTE_HOME/hosts/$host" ] && FAKE_REMOTE_HOME=$FAKE_REMOTE_HOME/hosts/$host',
    'export NMR_LOCK_DIR="$FAKE_REMOTE_HOME/nmr-lock"',
    'cd "$FAKE_REMOTE_HOME" || exit 255',
    'case "$host:$cmd" in dropping:*runHostSession*) HOME=$FAKE_REMOTE_HOME SHELL=$FAKE_LOGIN_SHELL /bin/sh -c "$cmd" >/dev/null; exit 255 ;; esac',
    'HOME=$FAKE_REMOTE_HOME SHELL=$FAKE_LOGIN_SHELL exec /bin/sh -c "$cmd"',
  ]);
  writeExecutable(tree, 'fake-bin/pnpm', [
    '#!/bin/sh',
    'case "$1" in',
    '  install)',
    '    echo "install $*" >> "$FAKE_PNPM_LOG"',
    '    if ls node_modules/.pnpm-workspace-state*.json >/dev/null 2>&1; then state=present; else state=absent; fi',
    '    echo "state=$state" >> "$FAKE_PNPM_LOG"',
    '    if [ -n "$FAKE_INSTALL_REAL" ]; then exec "$FAKE_INSTALL_REAL" "$@"; fi',
    '    mkdir -p node_modules && : > node_modules/.pnpm-workspace-state-v1.json',
    '    if [ -n "$FAKE_INSTALL_NOISE" ]; then yes "install progress" | head -n "$FAKE_INSTALL_NOISE"; echo "last install line"; fi',
    '    if [ -n "$FAKE_INSTALL_SLEEP" ]; then echo $$ > "$FAKE_INSTALL_PIDFILE"; sleep "$FAKE_INSTALL_SLEEP"; fi',
    '    exit "${FAKE_INSTALL_STATUS:-0}" ;;',
    '  exec)',
    '    shift 2',
    '    {',
    '      echo "cwd=$(pwd)"',
    '      echo "args=$*"',
    '      echo "style=$NMR_OUTPUT_STYLE"',
    '      echo "env=no-cache:${NMR_NO_CACHE-unset} debug:${NMR_DEBUG-unset} run-id:${NMR_RUN_ID:+set} snapshot:${NMR_TREE_SNAPSHOT:+set} lock-token:${NMR_LOCK_TOKEN:+set} no-lock:${NMR_NO_LOCK-unset}"',
    String.raw`      echo "files=$(ls -A | sort | tr '\n' ' ')"`,
    String.raw`      echo "bins=$(ls -A node_modules/.bin 2>/dev/null | sort | tr '\n' ' ')"`,
    '      [ -f probe.txt ] && echo "probe=$(cat probe.txt)"',
    '    } >> "$FAKE_PNPM_LOG"',
    // Write each element of the JSON array as one entry file, a string element as the file's raw content.
    `    if [ -n "$FAKE_RUN_MANIFEST" ]; then node -e 'const fs = require("node:fs"); JSON.parse(process.env.FAKE_RUN_MANIFEST).forEach((entry, index) => fs.writeFileSync(require("node:path").join(process.env.NMR_PASS_MANIFEST_DIR, index + ".json"), typeof entry === "string" ? entry : JSON.stringify(entry)));'; fi`,
    '    echo "remote stdout"',
    '    echo "remote stderr" >&2',
    // Start the sleep before writing the pid file, and wait for it rather than run it in the foreground. A `SIGTERM`
    // that reaches the forked shell before it execs `sleep` runs the inherited trap there and is lost, and a trapped
    // signal does not interrupt a foreground command, so the run would sleep on past the host session's stop grace.
    '    if [ -n "$FAKE_RUN_TERM_DELAY" ]; then trap \'kill "$fake_sleep_pid" 2>/dev/null; sleep "$FAKE_RUN_TERM_DELAY"; exit 143\' TERM; fi',
    '    if [ -n "$FAKE_RUN_SLEEP" ]; then sleep "$FAKE_RUN_SLEEP" & fake_sleep_pid=$!; echo $$ > "$FAKE_RUN_PIDFILE"; wait "$fake_sleep_pid"; fi',
    '    exit "${FAKE_RUN_STATUS:-0}" ;;',
    'esac',
    'exit 64',
  ]);

  return {
    addHost: (host) => tree.mkdir(`fake-home/hosts/${host}`),
    addSshWrapper: () => {
      const wrapperLog = tree.resolve('ssh-wrapper.log');
      const wrapperPath = writeExecutable(tree, 'fake bin/ssh wrapper', [
        '#!/bin/sh',
        // Log each call on one line, although the script that it carries spans several.
        `{ printf '%s' "$*" | tr '\\n' ' '; echo; } >> ${quoteForShell(wrapperLog)}`,
        `exec ${quoteForShell(path.join(binDir, 'ssh'))} "$@"`,
      ]);

      return {
        command: `${quoteForShell(wrapperPath)} -o "SetEnv=FAKE_WRAPPED=a b"`,
        readLog: () => readLog(wrapperLog),
      };
    },
    buildEnv: (extraEnv = {}) => ({
      ...omitSshCommand(readAmbientEnv()),
      FAKE_LOGIN_SHELL: path.join(binDir, 'login-shell'),
      FAKE_PNPM_LOG: pnpmLog,
      FAKE_REMOTE_HOME: home,
      FAKE_SSH_LOG: sshLog,
      PATH: `${binDir}${path.delimiter}${process.env['PATH'] ?? ''}`,
      ...extraEnv,
    }),
    home,
    readPnpmLog: () => readLog(pnpmLog),
    readSshLog: () => readLog(sshLog),
  };
}

// region | Helpers

/** Returns `env` without `GIT_SSH_COMMAND`. */
function omitSshCommand(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => name !== SSH_COMMAND_ENV_VAR));
}

/** Reads a log, one entry per line, or none when nothing has written it. */
function readLog(logPath: string): string[] {
  return fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').trim().split('\n') : [];
}

/** Writes a script from its lines into `tree`, makes it executable, and returns its path. */
function writeExecutable(tree: TempTree, entryPath: string, lines: readonly string[]): string {
  const scriptPath = tree.write(entryPath, `${lines.join('\n')}\n`);
  fs.chmodSync(scriptPath, 0o755);

  return scriptPath;
}

// endregion | Helpers
