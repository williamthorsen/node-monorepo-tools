import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { readAmbientEnv } from '../test-utils/readAmbientEnv.ts';

const MONOREPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const CLI_PATH = path.join(MONOREPO_ROOT, 'packages', 'nmr', 'dist', 'esm', 'cli.js');
const BIN_DIR = path.join(MONOREPO_ROOT, 'node_modules', '.bin');

/**
 * A leaf that reports whether the descriptor it inherited is a terminal. The marker is distinctive on both
 * sides, because a `false` reading spelled `not-tty` would satisfy an assertion looking for `tty`.
 */
const PROBE = String.raw`node -e "process.stdout.write('TTY:' + (process.stdout.isTTY === true) + '\n')"`;

/** A package leaf that reports whether its stdin is a terminal, marked apart from `PROBE` so neither matches the other. */
const STDIN_PROBE = String.raw`node -e "process.stdout.write('STDIN:' + (process.stdin.isTTY === true) + '\n')"`;

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  { scope: 'file' },
  makeFixture(() =>
    createTempTree(
      {
        '.config/nmr.config.ts': `export default ${JSON.stringify({ rootScripts: { probe: ['probe:leaf'], 'probe:leaf': PROBE } })};\n`,
        'package.json': JSON.stringify({ name: 'inherit-root', private: true, type: 'module' }),
        'packages/alpha/package.json': JSON.stringify({ name: 'alpha', scripts: { 'stdin-probe': STDIN_PROBE } }),
        'packages/beta/package.json': JSON.stringify({ name: 'beta', scripts: { 'stdin-probe': STDIN_PROBE } }),
        'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
      },
      { prefix: 'nmr-inherit-' },
    ),
  ),
);

// `script(1)` is the only way for a test to run nmr on a pseudo-terminal. The Claude Code sandbox denies the `openpty`
// call that `script` needs to allocate one; the suite cannot run there.
describe.skipIf(process.env['SANDBOX_RUNTIME'] !== undefined)('descriptor inheritance', () => {
  // The pair is what makes this a test of inheritance rather than of `script(1)`: the same composite reports a
  // terminal only when nmr had one to pass on.
  it('passes its terminal to the leaf below a structural step', ({ tree }) => {
    // Output through a terminal ends lines in CRLF, and BSD `script` also prefixes `^D\b\b`; the marker is
    // therefore matched as a substring.
    const { stdout } = run(wrapInTerminal([process.execPath, CLI_PATH, 'probe']), tree.dir);

    expect(stdout).toContain('TTY:true');
  });

  it('reports no terminal when nmr was given none', ({ tree }) => {
    const { stdout } = run([process.execPath, CLI_PATH, 'probe'], tree.dir);

    expect(stdout).toContain('TTY:false');
  });

  // The pair for the cases below: a terminal that reaches a package through pnpm is one a fan-out could withhold.
  it('passes its terminal to the package a one-package filter selects', ({ tree }) => {
    const { stdout } = run(wrapInTerminal([process.execPath, CLI_PATH, '-F', 'alpha', 'stdin-probe']), tree.dir);

    expect(stdout).toContain('STDIN:true');
  });

  it.for([
    { args: ['-R', 'stdin-probe'], scenario: 'a recursive run' },
    { args: ['-F', './packages/*', 'stdin-probe'], scenario: 'a filter selecting several packages' },
  ])('given $scenario, gives every package no terminal input', ({ args }, { tree }) => {
    const { stdout } = run(wrapInTerminal([process.execPath, CLI_PATH, ...args]), tree.dir);

    expect(stdout.match(/STDIN:false/g)).toHaveLength(2);
  });

  // region | Helpers

  /** Quotes a token for a POSIX shell, which reads everything inside single quotes literally. */
  function quoteForShell(token: string): string {
    return "'" + token.replaceAll("'", String.raw`'\''`) + "'";
  }

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

  /**
   * Returns an argv that runs the given one on a pseudo-terminal through `script(1)`. BSD `script` takes the
   * command as trailing arguments; util-linux `script` takes it as one shell string, whose tokens are quoted.
   */
  function wrapInTerminal(argv: readonly string[]): [string, ...string[]] {
    if (process.platform === 'darwin') {
      return ['script', '-q', '/dev/null', ...argv];
    }
    return ['script', '-q', '-c', argv.map((token) => quoteForShell(token)).join(' '), '/dev/null'];
  }

  // endregion | Helpers
});
