import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import type { CheckNodePinOptions } from '../node-pin.ts';
import { resolveTazeCliPath, runTaze, type SpawnOutcome } from '../taze.ts';

const FAKE_CLI_PATH = '/fake/taze/cli.mjs';

describe(runTaze, () => {
  it("forwards every argument to the taze CLI, in order and unmodified, after nmr's request timeout", async () => {
    const argv = await runCapturingArgv(['--recursive', 'major', '--write']);

    expect(argv).toStrictEqual([FAKE_CLI_PATH, '--request-timeout', '30000', '--recursive', 'major', '--write']);
  });

  it('gives taze a request timeout when the invocation does not set one', async () => {
    await expect(runCapturingArgv([])).resolves.toStrictEqual([FAKE_CLI_PATH, '--request-timeout', '30000']);
  });

  // Repeating the flag is not a harmless override: taze's parser collects the pair into an array and reads it
  // as a near-zero deadline, so every spelling has to suppress the default rather than merely lose to it.
  it.each([
    ['--request-timeout', '90000'],
    ['--request-timeout=90000'],
    ['--requestTimeout', '90000'],
    ['--requestTimeout=90000'],
  ])("keeps the invocation's own request timeout, given as %s", async (...supplied: string[]) => {
    const argv = await runCapturingArgv([...supplied, '--recursive']);

    expect(argv).toStrictEqual([FAKE_CLI_PATH, ...supplied, '--recursive']);
  });

  // taze collects everything past a bare `--` for a downstream tool and never reads a timeout there.
  it('still gives taze a request timeout when one appears after a bare --', async () => {
    const argv = await runCapturingArgv(['--recursive', '--', '--request-timeout', '90000']);

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
  it('places its request timeout ahead of the invocation, not after it', async () => {
    const argv = await runCapturingArgv(['--']);

    expect(argv).toStrictEqual([FAKE_CLI_PATH, '--request-timeout', '30000', '--']);
  });

  it('runs the CLI on the current Node executable', async () => {
    let spawnedWith = '';

    await runTaze([], {
      loadConfig: noConfig,
      checkNodePin: skipNodePin,
      resolveCliPath: () => '/fake/taze/cli.mjs',
      spawn: (nodePath) => {
        spawnedWith = nodePath;
        return { status: 0 };
      },
    });

    expect(spawnedWith).toBe(process.execPath);
  });

  it("propagates taze's exit code", async () => {
    const exitCode = await runTaze([], {
      loadConfig: noConfig,
      checkNodePin: skipNodePin,
      resolveCliPath: () => '/fake/taze/cli.mjs',
      spawn: () => ({ status: 3 }),
    });

    expect(exitCode).toBe(3);
  });

  it('reports an actionable error when taze cannot be resolved', async () => {
    const { stderr, read } = captureStream();

    const exitCode = await runTaze([], {
      checkNodePin: skipNodePin,
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

  it('does not spawn when resolution fails', async () => {
    let spawned = false;

    await runTaze([], {
      checkNodePin: skipNodePin,
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

  // A spawn failure does not include an exit status, so without this the launcher would return a bare 1
  // and would not tell the operator that taze never ran.
  it('reports a spawn failure rather than returning a silent 1', async () => {
    const { stderr, read } = captureStream();

    const exitCode = await runTaze([], {
      loadConfig: noConfig,
      checkNodePin: skipNodePin,
      resolveCliPath: () => '/fake/taze/cli.mjs',
      spawn: (): SpawnOutcome => ({ status: null, error: new Error('spawn ENOENT') }),
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(read()).toContain('Failed to run taze: spawn ENOENT');
  });

  it('falls back to a failing exit code when taze does not report a status', async () => {
    const exitCode = await runTaze([], {
      loadConfig: noConfig,
      checkNodePin: skipNodePin,
      resolveCliPath: () => '/fake/taze/cli.mjs',
      spawn: () => ({ status: null }),
    });

    expect(exitCode).toBe(1);
  });

  describe('Node pin check', () => {
    it('runs once per invocation, before the passes, with the config directory and the write flag', async () => {
      const events: string[] = [];
      const calls: Array<{ dir: string; options: CheckNodePinOptions }> = [];

      await runTaze(['--cwd', 'some/dir', '--write'], {
        checkNodePin: (dir, options) => {
          events.push('check');
          calls.push({ dir, options });
          return Promise.resolve();
        },
        loadConfig: () => Promise.resolve({ '@acme/*': 1 }),
        resolveCliPath: () => FAKE_CLI_PATH,
        spawn: () => {
          events.push('pass');
          return { status: 0 };
        },
        stderr: captureStream().stderr,
      });

      expect(events).toStrictEqual(['check', 'pass', 'pass']);
      expect(calls[0]?.dir).toBe(path.resolve('some/dir'));
      expect(calls[0]?.options).toMatchObject({ isSilent: false, shouldWrite: true });
    });

    it.each([
      [[], false],
      [['-w'], true],
      [['--', '--write'], false],
    ])('reads the write flag from %j as %s', async (args: string[], shouldWrite: boolean) => {
      let received: boolean | undefined;

      await runTaze(args, {
        checkNodePin: (_dir, options) => {
          received = options.shouldWrite;
          return Promise.resolve();
        },
        loadConfig: noConfig,
        resolveCliPath: () => FAKE_CLI_PATH,
        spawn: () => ({ status: 0 }),
      });

      expect(received).toBe(shouldWrite);
    });

    it.each(['--no-node-version', '--help', '-h', '--version', '-v'])('skips the check under %s', async (flag) => {
      let checkCount = 0;

      await runTaze([flag], {
        checkNodePin: () => {
          checkCount++;
          return Promise.resolve();
        },
        loadConfig: noConfig,
        resolveCliPath: () => FAKE_CLI_PATH,
        spawn: () => ({ status: 0 }),
      });

      expect(checkCount).toBe(0);
    });

    it("reports a check that throws and keeps taze's exit code", async () => {
      const { stderr, read } = captureStream();

      const exitCode = await runTaze([], {
        checkNodePin: () => Promise.reject(new Error('unexpected')),
        loadConfig: noConfig,
        resolveCliPath: () => FAKE_CLI_PATH,
        spawn: () => ({ status: 0 }),
        stderr,
      });

      expect(exitCode).toBe(0);
      expect(read()).toContain('Could not check the nodejs pin: unexpected');
    });
  });

  describe('with per-package maturity periods', () => {
    it('runs taze once per pass, each with the request timeout and the planned arguments', async () => {
      const { spawned, exitCode } = await runSplit(['--recursive'], { '@williamthorsen/*': 1 }, [0, 0]);

      expect(exitCode).toBe(0);
      expect(spawned).toStrictEqual([
        [
          FAKE_CLI_PATH,
          '--request-timeout',
          '30000',
          '--recursive',
          '--maturity-period',
          '1',
          '--exclude',
          '/^(?!@williamthorsen/.*?$)/',
        ],
        [FAKE_CLI_PATH, '--request-timeout', '30000', '--recursive', '--exclude', '@williamthorsen/*'],
      ]);
    });

    it('heads each pass on stderr', async () => {
      const { read } = await runSplit([], { a: 1 }, [0, 0]);

      expect(read()).toBe(
        'Packages matching a: 1-day maturity period\nAll other packages: configured maturity period\n',
      );
    });

    it.each([[['--silent']], [['--loglevel', 'silent']]])('omits the headings under %j', async (args) => {
      const { read } = await runSplit(args, { a: 1 }, [0, 0]);

      expect(read()).toBe('');
    });

    it('runs every pass and returns the first non-zero exit code', async () => {
      const { spawned, exitCode } = await runSplit([], { a: 1, b: 2 }, [0, 4, 5]);

      expect(spawned).toHaveLength(3);
      expect(exitCode).toBe(4);
    });

    it('stops at a spawn failure, which would fail every pass alike', async () => {
      const { stderr, read } = captureStream();
      let spawnCount = 0;

      const exitCode = await runTaze([], {
        loadConfig: () => Promise.resolve({ a: 1 }),
        checkNodePin: skipNodePin,
        resolveCliPath: () => FAKE_CLI_PATH,
        spawn: (): SpawnOutcome => {
          spawnCount += 1;
          return { status: null, error: new Error('spawn ENOENT') };
        },
        stderr,
      });

      expect(exitCode).toBe(1);
      expect(spawnCount).toBe(1);
      expect(read()).toContain('Failed to run taze: spawn ENOENT');
    });

    it('reports an invalid entry and spawns nothing', async () => {
      const { stderr, read } = captureStream();
      let spawned = false;

      const exitCode = await runTaze([], {
        loadConfig: () => Promise.resolve({ '/^@acme/': 1 }),
        checkNodePin: skipNodePin,
        resolveCliPath: () => FAKE_CLI_PATH,
        spawn: () => {
          spawned = true;
          return { status: 0 };
        },
        stderr,
      });

      expect(exitCode).toBe(1);
      expect(spawned).toBe(false);
      expect(read()).toContain("Could not read the taze config: packageMaturityPeriod entry '/^@acme/'");
    });

    it('reports a config that fails to load and spawns nothing', async () => {
      const { stderr, read } = captureStream();
      let spawned = false;

      const exitCode = await runTaze([], {
        loadConfig: () => Promise.reject(new Error('broken config')),
        checkNodePin: skipNodePin,
        resolveCliPath: () => FAKE_CLI_PATH,
        spawn: () => {
          spawned = true;
          return { status: 0 };
        },
        stderr,
      });

      expect(exitCode).toBe(1);
      expect(spawned).toBe(false);
      expect(read()).toContain('Could not read the taze config: broken config');
    });

    it.each([
      [['--cwd', 'packages/a'], 'packages/a'],
      [['--cwd=packages/a'], 'packages/a'],
      [['-C', 'packages/a'], 'packages/a'],
      [[], '.'],
    ])('loads the config governing the directory that %j names', async (args, dir) => {
      let loadedFrom = '';

      await runTaze(args, {
        loadConfig: (cwd) => {
          loadedFrom = cwd;
          return Promise.resolve(undefined);
        },
        checkNodePin: skipNodePin,
        resolveCliPath: () => FAKE_CLI_PATH,
        spawn: () => ({ status: 0 }),
      });

      expect(loadedFrom).toBe(path.resolve(dir));
    });
  });
});

describe(resolveTazeCliPath, () => {
  // The whole design depends on taze being resolvable from nmr's own tree rather than the consumer's,
  // so this exercises the real resolution instead of an injected stand-in.
  it("resolves taze's CLI entry to a file that exists", () => {
    const cliPath = resolveTazeCliPath();

    expect(fs.existsSync(cliPath)).toBe(true);
  });
});

/** Runs `runTaze` against a stubbed CLI path and spawn, returning the argv that the spawn received. */
async function runCapturingArgv(args: string[]): Promise<string[]> {
  let capturedArgs: string[] = [];

  await runTaze(args, {
    loadConfig: noConfig,
    checkNodePin: skipNodePin,
    resolveCliPath: () => FAKE_CLI_PATH,
    spawn: (_nodePath, argv) => {
      capturedArgs = argv;
      return { status: 0 };
    },
  });

  return capturedArgs;
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

/** Returns no per-package maturity periods, as a repo without the key does. */
function noConfig(): Promise<unknown> {
  return Promise.resolve(undefined);
}

/** Runs `runTaze` with `packageMaturityPeriod`, returning each pass's argv, the exit code, and a stderr reader. */
async function runSplit(
  args: string[],
  packageMaturityPeriod: Record<string, number>,
  statuses: number[],
): Promise<{ spawned: string[][]; exitCode: number; read: () => string }> {
  const { stderr, read } = captureStream();
  const spawned: string[][] = [];

  const exitCode = await runTaze(args, {
    loadConfig: () => Promise.resolve(packageMaturityPeriod),
    checkNodePin: skipNodePin,
    resolveCliPath: () => FAKE_CLI_PATH,
    spawn: (_nodePath, argv) => {
      spawned.push(argv);
      return { status: statuses[spawned.length - 1] ?? 0 };
    },
    stderr,
  });

  return { spawned, exitCode, read };
}

/** Stands in for the Node pin check, so that a test does not read `.tool-versions` or reach the network. */
function skipNodePin(): Promise<void> {
  return Promise.resolve();
}
