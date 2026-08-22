import fs from 'node:fs';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import type { SpawnOutcome } from '../taze.ts';
import { resolveTazeCliPath, runTaze } from '../taze.ts';

const FAKE_CLI_PATH = '/fake/taze/cli.mjs';

describe(runTaze, () => {
  it("forwards every argument to the taze CLI, in order and unmodified, behind nmr's request timeout", () => {
    const argv = runCapturingArgv(['--recursive', 'major', '--write']);

    expect(argv).toStrictEqual([FAKE_CLI_PATH, '--request-timeout', '30000', '--recursive', 'major', '--write']);
  });

  it('gives taze a request timeout when the invocation carries none', () => {
    expect(runCapturingArgv([])).toStrictEqual([FAKE_CLI_PATH, '--request-timeout', '30000']);
  });

  // Repeating the flag is not a harmless override: taze's parser collects the pair into an array and reads it
  // as a near-zero deadline, so every spelling has to suppress the default rather than merely lose to it.
  it.each([
    ['--request-timeout', '90000'],
    ['--request-timeout=90000'],
    ['--requestTimeout', '90000'],
    ['--requestTimeout=90000'],
  ])("keeps the invocation's own request timeout, given as %s", (...supplied: string[]) => {
    const argv = runCapturingArgv([...supplied, '--recursive']);

    expect(argv).toStrictEqual([FAKE_CLI_PATH, ...supplied, '--recursive']);
  });

  // taze collects everything past a bare `--` for a downstream tool, so a timeout there is one it never reads.
  it('still gives taze a request timeout when one appears after a bare --', () => {
    const argv = runCapturingArgv(['--recursive', '--', '--request-timeout', '90000']);

    expect(argv).toStrictEqual([
      FAKE_CLI_PATH,
      '--request-timeout',
      '30000',
      '--recursive',
      '--',
      '--request-timeout',
      '90000',
    ]);
  });

  // Appending would put the flag past a trailing `--`, where taze collects it instead of reading it.
  it('places its request timeout ahead of the invocation, not after it', () => {
    const argv = runCapturingArgv(['--']);

    expect(argv).toStrictEqual([FAKE_CLI_PATH, '--request-timeout', '30000', '--']);
  });

  it('runs the CLI on the current Node executable', () => {
    let spawnedWith = '';

    runTaze([], {
      resolveCliPath: () => '/fake/taze/cli.mjs',
      spawn: (nodePath) => {
        spawnedWith = nodePath;
        return { status: 0 };
      },
    });

    expect(spawnedWith).toBe(process.execPath);
  });

  it("propagates taze's exit code", () => {
    const exitCode = runTaze([], {
      resolveCliPath: () => '/fake/taze/cli.mjs',
      spawn: () => ({ status: 3 }),
    });

    expect(exitCode).toBe(3);
  });

  it('reports an actionable error when taze cannot be resolved', () => {
    const { stderr, read } = captureStream();

    const exitCode = runTaze([], {
      resolveCliPath: () => {
        throw new Error("Cannot find package 'taze'");
      },
      spawn: () => ({ status: 0 }),
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(read()).toContain("Could not resolve 'taze/cli'");
    expect(read()).toContain('Reinstall the workspace');
  });

  it('does not spawn when resolution fails', () => {
    let spawned = false;

    runTaze([], {
      resolveCliPath: () => {
        throw new Error("Cannot find package 'taze'");
      },
      spawn: () => {
        spawned = true;
        return { status: 0 };
      },
      stderr: captureStream().stderr,
    });

    expect(spawned).toBe(false);
  });

  // A spawn failure carries no exit status, so without this the launcher would return a bare 1 and
  // leave the operator with no indication that taze never ran.
  it('reports a spawn failure rather than returning a silent 1', () => {
    const { stderr, read } = captureStream();

    const exitCode = runTaze([], {
      resolveCliPath: () => '/fake/taze/cli.mjs',
      spawn: (): SpawnOutcome => ({ status: null, error: new Error('spawn ENOENT') }),
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(read()).toContain('Failed to run taze: spawn ENOENT');
  });

  it('falls back to a failing exit code when taze reports no status', () => {
    const exitCode = runTaze([], {
      resolveCliPath: () => '/fake/taze/cli.mjs',
      spawn: () => ({ status: null }),
    });

    expect(exitCode).toBe(1);
  });
});

describe(resolveTazeCliPath, () => {
  // The whole design rests on taze being resolvable from nmr's own tree rather than the consumer's,
  // so this exercises the real resolution instead of an injected stand-in.
  it("resolves taze's CLI entry to a file that exists", () => {
    const cliPath = resolveTazeCliPath();

    expect(fs.existsSync(cliPath)).toBe(true);
  });
});

/** Runs `runTaze` against a stubbed CLI path and spawn, returning the argv the spawn received. */
function runCapturingArgv(args: string[]): string[] {
  let captured: string[] = [];

  runTaze(args, {
    resolveCliPath: () => FAKE_CLI_PATH,
    spawn: (_nodePath, argv) => {
      captured = argv;
      return { status: 0 };
    },
  });

  return captured;
}

/** Returns a writable stream plus a reader for everything written to it. */
function captureStream(): { stderr: PassThrough; read: () => string } {
  const chunks: string[] = [];
  const stderr = new PassThrough();
  stderr.on('data', (chunk: Buffer) => {
    chunks.push(chunk.toString());
  });

  return { stderr, read: () => chunks.join('') };
}
