import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const MONOREPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const CLI_PATH = path.join(MONOREPO_ROOT, 'packages', 'nmr', 'dist', 'esm', 'cli.js');
const BIN_DIR = path.join(MONOREPO_ROOT, 'node_modules', '.bin');

/**
 * A leaf that reports whether the descriptor it was handed is a terminal. The marker is distinctive on both
 * sides, because a `false` reading spelled `not-tty` would satisfy an assertion looking for `tty`.
 */
const PROBE = String.raw`node -e "process.stdout.write('TTY:' + (process.stdout.isTTY === true) + '\n')"`;

// `script(1)` is the only way to hand nmr a terminal from a test, and its flags are not portable: BSD takes
// `script -q <file> <command>` where util-linux takes `script -q -c "<command>" <file>`. CI runs on Linux, so
// the inherit path goes uncovered there until a util-linux branch is added.
describe.skipIf(process.platform !== 'darwin')('descriptor inheritance', () => {
  let repo: string;

  beforeAll(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-inherit-')));
    fs.writeFileSync(path.join(repo, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    fs.mkdirSync(path.join(repo, '.config'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, '.config', 'nmr.config.ts'),
      `export default ${JSON.stringify({ rootScripts: { probe: ['probe:leaf'], 'probe:leaf': PROBE } })};\n`,
    );
  });

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  // The pair is what makes this a test of inheritance rather than of `script(1)`: the same composite reports a
  // terminal only when nmr had one to hand down.
  it('hands its terminal to the leaf below a structural step', () => {
    // BSD `script` prefixes `^D\b\b` and emits CRLF, so the marker is matched as a substring.
    const { stdout } = run(['script', '-q', '/dev/null', process.execPath, CLI_PATH, 'probe']);

    expect(stdout).toContain('TTY:true');
  });

  it('reports no terminal when nmr was given none', () => {
    const { stdout } = run([process.execPath, CLI_PATH, 'probe']);

    expect(stdout).toContain('TTY:false');
  });

  // region | Helpers

  /**
   * Runs a command against the fixture repo. `.bin` joins PATH because a structural step spawns `nmr` by argv,
   * which a temporary working directory cannot resolve on its own, and the cache variables are dropped because
   * the suite may itself be running under `nmr test`.
   *
   * stdin comes from `/dev/null` rather than the socket `spawnSync` supplies by default: BSD `script` copies
   * its own terminal settings before allocating a pty, and `tcgetattr` on a socket fails outright.
   */
  function run(argv: readonly [string, ...string[]]): { stdout: string } {
    const [file, ...args] = argv;
    const { NMR_TREE_SNAPSHOT: _snapshot, NMR_NO_CACHE: _noCache, NMR_DEBUG: _debug, ...ambient } = process.env;

    const result = spawnSync(file, args, {
      cwd: repo,
      encoding: 'utf8',
      env: { ...ambient, PATH: `${BIN_DIR}${path.delimiter}${ambient['PATH'] ?? ''}` },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });

    return { stdout: result.stdout };
  }

  // endregion | Helpers
});
