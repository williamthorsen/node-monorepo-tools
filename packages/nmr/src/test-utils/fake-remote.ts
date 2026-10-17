import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import type { TempTree } from '@williamthorsen/toolbelt.testing/candidate';

import { readAmbientEnv } from './readAmbientEnv.ts';

/** A host simulated on this machine: an `ssh` and a `pnpm` that run the host's side locally, and their logs. */
export interface FakeRemote {
  /** Returns an environment in which `ssh` and `pnpm` resolve to the fakes. */
  buildEnv: (extraEnv?: Record<string, string>) => NodeJS.ProcessEnv;
  /** The directory that stands for the host's home. */
  home: string;
  /** Reads what the fake `pnpm` logged, one entry per line. */
  readPnpmLog: () => string[];
}

/**
 * Creates a fake host under `tree`. The fake `ssh` runs its command with `/bin/sh` in the fake home, rewriting git's
 * `git-receive-pack` to the `git receive-pack` form that does not need git's exec path on `PATH`; a host named
 * `unreachable` fails as `ssh` does. The fake login shell drops `-l`, so that a profile on this machine cannot
 * reorder `PATH` ahead of the fakes.
 *
 * The fake `pnpm` logs each call. Its `exec` logs the directory, the arguments, the output style, and the files in
 * the directory and the content of `probe.txt` when there is one, then prints to both streams. These variables
 * steer it: `FAKE_INSTALL_STATUS` and `FAKE_RUN_STATUS` set exit statuses, and `FAKE_RUN_SLEEP` makes the run write
 * its pid to `FAKE_RUN_PIDFILE` and sleep.
 */
export function createFakeRemote(tree: TempTree): FakeRemote {
  const binDir = tree.mkdir('fake-bin');
  const home = tree.mkdir('fake-home');
  const pnpmLog = tree.resolve('pnpm.log');

  writeExecutable(tree, 'fake-bin/login-shell', [
    '#!/bin/sh',
    '[ "$1" = -lc ] && shift && exec /bin/sh -c "$@"',
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
    'if [ "$host" = unreachable ]; then echo "ssh: connect to host unreachable: Connection refused" >&2; exit 255; fi',
    'cmd="$*"',
    'case "$cmd" in git-receive-pack\\ *) cmd="git receive-pack ${cmd#git-receive-pack }" ;; esac',
    'cd "$FAKE_REMOTE_HOME" || exit 255',
    'HOME=$FAKE_REMOTE_HOME SHELL=$FAKE_LOGIN_SHELL exec /bin/sh -c "$cmd"',
  ]);
  writeExecutable(tree, 'fake-bin/pnpm', [
    '#!/bin/sh',
    'case "$1" in',
    '  install) echo "install $*" >> "$FAKE_PNPM_LOG"; exit "${FAKE_INSTALL_STATUS:-0}" ;;',
    '  exec)',
    '    shift 2',
    '    {',
    '      echo "cwd=$(pwd)"',
    '      echo "args=$*"',
    '      echo "style=$NMR_OUTPUT_STYLE"',
    String.raw`      echo "files=$(ls -A | sort | tr '\n' ' ')"`,
    '      [ -f probe.txt ] && echo "probe=$(cat probe.txt)"',
    '    } >> "$FAKE_PNPM_LOG"',
    '    echo "remote stdout"',
    '    echo "remote stderr" >&2',
    '    if [ -n "$FAKE_RUN_SLEEP" ]; then echo $$ > "$FAKE_RUN_PIDFILE"; sleep "$FAKE_RUN_SLEEP"; fi',
    '    exit "${FAKE_RUN_STATUS:-0}" ;;',
    'esac',
    'exit 64',
  ]);

  return {
    buildEnv: (extraEnv = {}) => ({
      ...readAmbientEnv(),
      FAKE_LOGIN_SHELL: path.join(binDir, 'login-shell'),
      FAKE_PNPM_LOG: pnpmLog,
      FAKE_REMOTE_HOME: home,
      PATH: `${binDir}${path.delimiter}${process.env['PATH'] ?? ''}`,
      ...extraEnv,
    }),
    home,
    readPnpmLog: () => (fs.existsSync(pnpmLog) ? fs.readFileSync(pnpmLog, 'utf8').trim().split('\n') : []),
  };
}

// region | Helpers

/** Writes a script from its lines into `tree` and makes it executable. */
function writeExecutable(tree: TempTree, entryPath: string, lines: readonly string[]): void {
  fs.chmodSync(tree.write(entryPath, `${lines.join('\n')}\n`), 0o755);
}

// endregion | Helpers
