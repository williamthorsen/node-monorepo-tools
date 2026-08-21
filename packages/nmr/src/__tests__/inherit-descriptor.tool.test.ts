import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { readAmbientEnv } from '../test-utils/readAmbientEnv.ts';

const MONOREPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const CLI_PATH = path.join(MONOREPO_ROOT, 'packages', 'nmr', 'dist', 'esm', 'cli.js');
const BIN_DIR = path.join(MONOREPO_ROOT, 'node_modules', '.bin');

/**
 * A leaf that reports whether the descriptor it was handed is a terminal. The marker is distinctive on both
 * sides, because a `false` reading spelled `not-tty` would satisfy an assertion looking for `tty`.
 */
const PROBE = String.raw`node -e "process.stdout.write('TTY:' + (process.stdout.isTTY === true) + '\n')"`;

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  { scope: 'file' },
  makeFixture(() =>
    createTempTree(
      {
        '.config/nmr.config.ts': `export default ${JSON.stringify({ rootScripts: { probe: ['probe:leaf'], 'probe:leaf': PROBE } })};\n`,
        'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
      },
      { prefix: 'nmr-inherit-' },
    ),
  ),
);

// `script(1)` is the only way to hand nmr a terminal from a test, and its flags are not portable: BSD takes
// `script -q <file> <command>` where util-linux takes `script -q -c "<command>" <file>`. CI runs on Linux, so
// the inherit path goes uncovered there until a util-linux branch is added.
describe.skipIf(process.platform !== 'darwin')('descriptor inheritance', () => {
  // The pair is what makes this a test of inheritance rather than of `script(1)`: the same composite reports a
  // terminal only when nmr had one to hand down.
  it('hands its terminal to the leaf below a structural step', ({ tree }) => {
    // BSD `script` prefixes `^D\b\b` and emits CRLF, so the marker is matched as a substring.
    const { stdout } = run(['script', '-q', '/dev/null', process.execPath, CLI_PATH, 'probe'], tree.dir);

    expect(stdout).toContain('TTY:true');
  });

  it('reports no terminal when nmr was given none', ({ tree }) => {
    const { stdout } = run([process.execPath, CLI_PATH, 'probe'], tree.dir);

    expect(stdout).toContain('TTY:false');
  });

  // region | Helpers

  /**
   * Runs a command against the fixture repo. `.bin` joins PATH because a structural step spawns `nmr` by argv,
   * which a temporary working directory cannot resolve on its own, and nmr's own variables are dropped because
   * an inherited verbosity would suppress the output these assertions read.
   *
   * stdin comes from `/dev/null` rather than the socket `spawnSync` supplies by default: BSD `script` copies
   * its own terminal settings before allocating a pty, and `tcgetattr` on a socket fails outright.
   */
  function run(argv: readonly [string, ...string[]], cwd: string): { stdout: string } {
    const [file, ...args] = argv;
    const ambient = readAmbientEnv();

    const result = spawnSync(file, args, {
      cwd,
      encoding: 'utf8',
      env: { ...ambient, PATH: `${BIN_DIR}${path.delimiter}${ambient['PATH'] ?? ''}` },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });

    return { stdout: result.stdout };
  }

  // endregion | Helpers
});
