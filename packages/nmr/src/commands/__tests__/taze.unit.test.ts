import fs from 'node:fs';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import type { SpawnOutcome } from '../taze.ts';
import { resolveTazeCliPath, runTaze } from '../taze.ts';

describe(runTaze, () => {
  it('forwards every argument to the taze CLI, in order and unmodified', () => {
    const calls: Array<{ nodePath: string; argv: string[] }> = [];

    runTaze(['--include-locked', '--recursive', 'major'], {
      resolveCliPath: () => '/fake/taze/cli.mjs',
      spawn: (nodePath, argv) => {
        calls.push({ nodePath, argv });
        return { status: 0 };
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.argv).toStrictEqual(['/fake/taze/cli.mjs', '--include-locked', '--recursive', 'major']);
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

/** Returns a writable stream plus a reader for everything written to it. */
function captureStream(): { stderr: PassThrough; read: () => string } {
  const chunks: string[] = [];
  const stderr = new PassThrough();
  stderr.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));

  return { stderr, read: () => chunks.join('') };
}
