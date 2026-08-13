import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OutputChannels } from '../runner.ts';
import { resolveChannel, resolveInheritedChannel, runCommand, runSteps } from '../runner.ts';
import type { Step } from '../steps.ts';

vi.mock(import('node:child_process'), () => ({
  spawn: vi.fn(),
}));

const mockedSpawn = vi.mocked(spawn);

/** What a caller writing to a non-terminal destination resolves, which is the arrangement most of these model. */
const PIPED_CHANNELS: OutputChannels = { stderr: 'pipe', stdout: 'pipe' };

interface FakeChild extends EventEmitter {
  stdout: PassThrough | null;
  stderr: PassThrough | null;
}

/**
 * Installs a spawn mock whose child mirrors the stdio the runner asked for: a pipe becomes a `PassThrough`,
 * a descriptor becomes `null`, exactly as `child_process` behaves.
 */
function stubSpawn(): () => FakeChild {
  let child: FakeChild | undefined;

  mockedSpawn.mockImplementation((_command, _args, options) => {
    const stdio = Array.isArray(options.stdio) ? options.stdio : [];
    // eslint-disable-next-line unicorn/prefer-event-target -- the runner attaches EventEmitter listeners to the child.
    const fake = Object.assign(new EventEmitter(), {
      stdout: stdio[1] === 'pipe' ? new PassThrough() : null,
      stderr: stdio[2] === 'pipe' ? new PassThrough() : null,
    });
    child = fake;
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the runner reads only stdout, stderr, and the event methods, so the fake models those alone.
    return fake as unknown as ReturnType<typeof spawn>;
  });

  return () => {
    if (child === undefined) throw new Error('spawn was not called');
    return child;
  };
}

/** Reads the stdio array the runner passed to spawn. */
function stdioFromCall(): unknown[] {
  const options = mockedSpawn.mock.calls[0]?.[2];
  if (!options || !Array.isArray(options.stdio)) throw new Error('Expected stdio to be an array');
  return options.stdio;
}

/** Returns the child's stdout pipe, failing the test when the runner chose a descriptor instead. */
function requireStdout(child: FakeChild): PassThrough {
  if (child.stdout === null) throw new Error('Expected the runner to pipe stdout');
  return child.stdout;
}

/** Ends the child's pipes, lets them flush, then emits the exit and close events Node would. */
async function endChild(child: FakeChild, code: number | null = 0, signal: NodeJS.Signals | null = null) {
  const flushes: Promise<void>[] = [];
  for (const stream of [child.stdout, child.stderr]) {
    if (stream === null) continue;
    flushes.push(new Promise<void>((resolve) => stream.on('end', () => resolve())));
    stream.end();
  }
  await Promise.all(flushes);
  child.emit('exit', code, signal);
  child.emit('close');
}

/** Builds a stream that reports itself as a terminal, so the runner hands its descriptor to the child. */
function createTerminalStream() {
  return Object.assign(new PassThrough(), { fd: 1, isTTY: true });
}

/** Builds a stream carrying a descriptor without being a terminal, which is a redirected stdout. */
function createRedirectedStream() {
  return Object.assign(new PassThrough(), { fd: 1 });
}

/** What one step of a stubbed sequence writes before it exits. */
interface StepOutput {
  stderr?: string;
  stdout?: string;
}

/**
 * Installs a spawn mock that ends each child as soon as it is created, taking each exit code and each step's
 * output from the queues in turn, so a step list runs to completion without the test driving every child by
 * hand.
 */
function stubSequence(exitCodes: readonly number[], outputs: readonly StepOutput[] = []): void {
  let index = 0;

  mockedSpawn.mockImplementation((_file, _args, options) => {
    const stdio = Array.isArray(options.stdio) ? options.stdio : [];
    // eslint-disable-next-line unicorn/prefer-event-target -- the runner attaches EventEmitter listeners to the child.
    const fake = Object.assign(new EventEmitter(), {
      stdout: stdio[1] === 'pipe' ? new PassThrough() : null,
      stderr: stdio[2] === 'pipe' ? new PassThrough() : null,
    });
    const exitCode = exitCodes[index] ?? 0;
    const output = outputs[index] ?? {};
    index++;
    setImmediate(() => {
      if (output.stdout !== undefined) fake.stdout?.write(output.stdout);
      if (output.stderr !== undefined) fake.stderr?.write(output.stderr);
      void endChild(fake, exitCode);
    });
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the runner reads only stdout, stderr, and the event methods, so the fake models those alone.
    return fake as unknown as ReturnType<typeof spawn>;
  });
}

/** Reads the file each spawn was asked for, in call order. */
function filesFromCalls(): (string | undefined)[] {
  return mockedSpawn.mock.calls.map((call) => call[0]);
}

/** Builds a stream that accepts nothing until released, so a pipe into it must apply back-pressure. */
function createBlockingStream(): { stream: Writable; release: () => void } {
  let pendingCallback: (() => void) | undefined;
  const stream = new Writable({
    highWaterMark: 1,
    write(_chunk, _encoding, callback) {
      pendingCallback = () => callback();
    },
  });
  return {
    stream,
    release: () => pendingCallback?.(),
  };
}

/** Collects everything written to a stream, for comparison against what the child produced. */
function collect(stream: PassThrough): () => Buffer {
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });
  return () => Buffer.concat(chunks);
}

/** Yields to the event loop so piped chunks reach their destination. */
function flushEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe(resolveChannel, () => {
  it.each([
    { channel: 1, isQuiet: false, scenario: 'a terminal destination in loud mode', useTerminal: true },
    { channel: 'pipe', isQuiet: false, scenario: 'a piped destination in loud mode', useTerminal: false },
    { channel: 'pipe', isQuiet: true, scenario: 'a terminal destination in quiet mode', useTerminal: true },
    { channel: 'pipe', isQuiet: true, scenario: 'a piped destination in quiet mode', useTerminal: false },
  ])('given $scenario, resolves to $channel', ({ channel, isQuiet, useTerminal }) => {
    const destination = useTerminal ? createTerminalStream() : new PassThrough();

    expect(resolveChannel(destination, isQuiet)).toBe(channel);
  });
});

describe(resolveInheritedChannel, () => {
  it.each([
    { channel: 1, scenario: 'a terminal destination', createStream: createTerminalStream },
    { channel: 1, scenario: 'a destination redirected to a file', createStream: createRedirectedStream },
    { channel: 'pipe', scenario: 'a destination carrying no descriptor', createStream: () => new PassThrough() },
  ])('given $scenario, resolves to $channel', ({ channel, createStream }) => {
    expect(resolveInheritedChannel(createStream())).toBe(channel);
  });
});

describe(runCommand, () => {
  beforeEach(() => {
    mockedSpawn.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('stream routing', () => {
    it('runs each stream on the channel the caller chose', async () => {
      const getChild = stubSpawn();

      const pending = runCommand('cmd', undefined, {
        channels: { stderr: 2, stdout: 'pipe' },
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });
      await endChild(getChild());
      await pending;

      expect(stdioFromCall().slice(1)).toStrictEqual(['pipe', 2]);
    });

    it('given a descriptor channel, retains no copy of that stream', async () => {
      const getChild = stubSpawn();

      const pending = runCommand('cmd', undefined, {
        channels: { stderr: 'pipe', stdout: 1 },
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });
      await endChild(getChild());
      const result = await pending;

      expect(result.stdout).toBeUndefined();
    });

    it('inherits stdin so an interactive command keeps its input', async () => {
      const getChild = stubSpawn();

      const pending = runCommand('cmd', undefined, {
        channels: PIPED_CHANNELS,
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });
      await endChild(getChild());
      await pending;

      expect(stdioFromCall()[0]).toBe('inherit');
    });

    it('passes caller-supplied env and cwd to spawn', async () => {
      const getChild = stubSpawn();

      const pending = runCommand('echo $FOO', '/tmp', {
        channels: PIPED_CHANNELS,
        env: { FOO: 'bar' },
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });
      await endChild(getChild());
      await pending;

      expect(mockedSpawn.mock.calls[0]?.[2]).toMatchObject({ cwd: '/tmp', env: { FOO: 'bar' }, shell: true });
    });
  });

  describe('forwarding', () => {
    it('forwards a chunk before the command exits', async () => {
      const getChild = stubSpawn();
      const destination = new PassThrough();
      const received = collect(destination);

      const pending = runCommand('cmd', undefined, {
        channels: PIPED_CHANNELS,
        stderr: new PassThrough(),
        stdout: destination,
      });
      const child = getChild();
      requireStdout(child).write('first');
      await flushEventLoop();

      expect(received().toString('utf8')).toBe('first');

      await endChild(child);
      await pending;
    });

    it('when the destination applies back-pressure, pauses the child stream until it drains', async () => {
      const getChild = stubSpawn();
      const { release, stream } = createBlockingStream();

      const pending = runCommand('cmd', undefined, {
        channels: PIPED_CHANNELS,
        stderr: new PassThrough(),
        stdout: stream,
      });
      const child = getChild();
      const childStdout = requireStdout(child);
      childStdout.write('a'.repeat(64));
      await flushEventLoop();

      expect(childStdout.isPaused()).toBe(true);

      release();
      await flushEventLoop();

      expect(childStdout.isPaused()).toBe(false);

      await endChild(child);
      await pending;
    });

    it('does not end a caller-supplied destination, so a later command can still write to it', async () => {
      const getChild = stubSpawn();
      const destination = new PassThrough();

      const pending = runCommand('cmd', undefined, {
        channels: PIPED_CHANNELS,
        stderr: new PassThrough(),
        stdout: destination,
      });
      await endChild(getChild());
      await pending;

      expect(destination.writableEnded).toBe(false);
      expect(destination.write('later')).toBe(true);
    });

    it('when output exceeds the retained bound, forwards every byte the command produced', async () => {
      const getChild = stubSpawn();
      const destination = new PassThrough();
      const received = collect(destination);
      const produced = Buffer.alloc(3_000_000, 'a');

      const pending = runCommand('cmd', undefined, {
        channels: PIPED_CHANNELS,
        stderr: new PassThrough(),
        stdout: destination,
      });
      const child = getChild();
      requireStdout(child).write(produced);
      const result = await (async () => {
        await endChild(child);
        return pending;
      })();

      expect(received()).toHaveLength(produced.length);
      expect(result.stdout?.length).toBeLessThan(produced.length);
    });
  });

  describe('destination failure', () => {
    it('when the destination errors, destroys the child stream and reports the capture as incomplete', async () => {
      const getChild = stubSpawn();
      const destination = new PassThrough();

      const pending = runCommand('cmd', undefined, {
        channels: PIPED_CHANNELS,
        stderr: new PassThrough(),
        stdout: destination,
      });
      const child = getChild();
      const childStdout = requireStdout(child);
      destination.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
      await flushEventLoop();

      expect(childStdout.destroyed).toBe(true);

      child.emit('exit', 0, null);
      child.emit('close');
      const result = await pending;

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBeUndefined();
    });
  });

  describe('outcome', () => {
    it('when the command exits non-zero, returns that code', async () => {
      const getChild = stubSpawn();

      const pending = runCommand('failing-command', undefined, {
        channels: PIPED_CHANNELS,
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });
      await endChild(getChild(), 2);

      await expect(pending).resolves.toMatchObject({ exitCode: 2, outcome: 'exited' });
    });

    it('when the command dies by signal, returns 128 plus the signal number', async () => {
      const getChild = stubSpawn();

      const pending = runCommand('killed-command', undefined, {
        channels: PIPED_CHANNELS,
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });
      await endChild(getChild(), null, 'SIGTERM');

      await expect(pending).resolves.toMatchObject({ exitCode: 143, outcome: 'signaled', signal: 'SIGTERM' });
    });

    it('when the spawn fails, returns 1 and writes the error line to the error stream', async () => {
      const getChild = stubSpawn();
      const errorStream = new PassThrough();
      const reported = collect(errorStream);

      const pending = runCommand('nonexistent-bin', undefined, {
        channels: PIPED_CHANNELS,
        stderr: errorStream,
        stdout: new PassThrough(),
      });
      getChild().emit('error', new Error('spawn /bin/sh ENOENT'));
      const result = await pending;
      await flushEventLoop();

      expect(result).toMatchObject({ exitCode: 1, outcome: 'spawn-failed' });
      expect(reported().toString('utf8')).toBe('Error: spawn /bin/sh ENOENT\n');
    });

    it('when a descendant holds the pipe open, resolves on the exit status after the grace period', async () => {
      const getChild = stubSpawn();
      const destination = new PassThrough();
      const received = collect(destination);

      const pending = runCommand('cmd', undefined, {
        channels: PIPED_CHANNELS,
        stderr: new PassThrough(),
        stdout: destination,
      });
      const child = getChild();
      requireStdout(child).write('produced');
      await flushEventLoop();
      // `close` never arrives: the descendant still holds the write end of the pipe.
      child.emit('exit', 3, null);
      const result = await pending;

      expect(result).toMatchObject({ exitCode: 3, outcome: 'exited' });
      expect(requireStdout(child).destroyed).toBe(true);
      expect(received().toString('utf8')).toBe('produced');
      // What the command wrote before exiting is its whole output, so the retained copy stands.
      expect(result.stdout?.toString('utf8')).toBe('produced');
    }, 20_000);

    it('when a descendant holds the pipe open, leaves no pipe listeners on a shared destination', async () => {
      vi.useFakeTimers();
      const destination = new PassThrough();
      destination.resume();

      for (let run = 0; run < 3; run++) {
        const getChild = stubSpawn();
        const pending = runCommand('cmd', undefined, {
          channels: PIPED_CHANNELS,
          stderr: new PassThrough(),
          stdout: destination,
        });
        getChild().emit('exit', 0, null);
        await vi.advanceTimersByTimeAsync(2_000);
        await pending;
      }

      for (const event of ['close', 'error', 'finish', 'unpipe'] as const) {
        expect(destination.listenerCount(event)).toBe(0);
      }
    });
  });

  describe('quiet mode', () => {
    it('writes nothing when the command succeeds', async () => {
      const getChild = stubSpawn();
      const errorStream = new PassThrough();
      const reported = collect(errorStream);

      const pending = runCommand('cmd', undefined, {
        channels: PIPED_CHANNELS,
        quiet: true,
        stderr: errorStream,
        stdout: new PassThrough(),
      });
      const child = getChild();
      requireStdout(child).write('some output');
      await endChild(child);
      await pending;
      await flushEventLoop();

      expect(reported()).toHaveLength(0);
    });

    it('writes retained stdout then stderr to the error stream when the command fails', async () => {
      const getChild = stubSpawn();
      const errorStream = new PassThrough();
      const reported = collect(errorStream);

      const pending = runCommand('lint', undefined, {
        channels: PIPED_CHANNELS,
        quiet: true,
        stderr: errorStream,
        stdout: new PassThrough(),
      });
      const child = getChild();
      requireStdout(child).write('lint errors\n');
      child.stderr?.write('error details\n');
      await endChild(child, 1);
      await pending;
      await flushEventLoop();

      expect(reported().toString('utf8')).toBe('lint errors\nerror details\n');
    });
  });
});

const OPAQUE_STEP: Step = { kind: 'opaque', command: 'eslint .' };
const STRUCTURAL_STEP: Step = { kind: 'structural', argv: ['nmr', '-w', 'typecheck'] };

describe(runSteps, () => {
  beforeEach(() => {
    mockedSpawn.mockReset();
  });

  describe('sequencing', () => {
    it('runs every step when each succeeds', async () => {
      stubSequence([0, 0, 0]);

      const result = await runSteps([STRUCTURAL_STEP, OPAQUE_STEP, STRUCTURAL_STEP], undefined, {
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });

      expect(result.exitCode).toBe(0);
      expect(mockedSpawn).toHaveBeenCalledTimes(3);
    });

    it('stops at the first non-zero exit and returns that code', async () => {
      stubSequence([0, 2, 0]);

      const result = await runSteps([STRUCTURAL_STEP, OPAQUE_STEP, STRUCTURAL_STEP], undefined, {
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });

      expect(result.exitCode).toBe(2);
      expect(mockedSpawn).toHaveBeenCalledTimes(2);
    });

    it('runs the steps in the order given', async () => {
      stubSequence([0, 0]);

      await runSteps([OPAQUE_STEP, STRUCTURAL_STEP], undefined, {
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });

      expect(filesFromCalls()).toStrictEqual(['eslint .', 'nmr']);
    });

    it('given an empty step list, exits 0 without spawning', async () => {
      stubSequence([]);

      const result = await runSteps([], undefined, { stderr: new PassThrough(), stdout: new PassThrough() });

      expect(result).toStrictEqual({ exitCode: 0 });
      expect(mockedSpawn).not.toHaveBeenCalled();
    });
  });

  describe('spawning', () => {
    it('hands an opaque step to a shell as one command line', async () => {
      stubSequence([0]);

      await runSteps([OPAQUE_STEP], '/repo', { stderr: new PassThrough(), stdout: new PassThrough() });

      expect(mockedSpawn.mock.calls[0]?.slice(0, 2)).toStrictEqual(['eslint .', []]);
      expect(mockedSpawn.mock.calls[0]?.[2]).toMatchObject({ cwd: '/repo', shell: true });
    });

    it('spawns a structural step by argv, so no shell reads its arguments', async () => {
      stubSequence([0]);

      await runSteps([{ kind: 'structural', argv: ['nmr', 'test', '-t', 'a b'] }], '/repo', {
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });

      expect(mockedSpawn.mock.calls[0]?.slice(0, 2)).toStrictEqual(['nmr', ['test', '-t', 'a b']]);
      expect(mockedSpawn.mock.calls[0]?.[2]).toMatchObject({ shell: false });
    });
  });

  describe('channels', () => {
    it.each([
      { expected: [1, 1], isQuiet: false, scenario: 'a loud run' },
      { expected: [1, 1], isQuiet: true, scenario: 'a quiet run' },
    ])('given $scenario, hands a structural step nmr descriptors', async ({ expected, isQuiet }) => {
      stubSequence([0]);

      await runSteps([STRUCTURAL_STEP], undefined, {
        quiet: isQuiet,
        stderr: Object.assign(new PassThrough(), { fd: 1 }),
        stdout: Object.assign(new PassThrough(), { fd: 1 }),
      });

      expect(stdioFromCall().slice(1)).toStrictEqual(expected);
    });

    it('falls back to a pipe for a structural step when the stream carries no descriptor', async () => {
      stubSequence([0]);

      await runSteps([STRUCTURAL_STEP], undefined, { stderr: new PassThrough(), stdout: new PassThrough() });

      expect(stdioFromCall().slice(1)).toStrictEqual(['pipe', 'pipe']);
    });

    it('withholds an opaque step under quiet, where a descriptor would leave nothing to withhold', async () => {
      stubSequence([0]);

      await runSteps([OPAQUE_STEP], undefined, {
        quiet: true,
        stderr: createTerminalStream(),
        stdout: createTerminalStream(),
      });

      expect(stdioFromCall().slice(1)).toStrictEqual(['pipe', 'pipe']);
    });
  });

  describe('retention', () => {
    it('carries back what an opaque step wrote, each stream apart from the other', async () => {
      stubSequence([0], [{ stderr: 'a warning\n', stdout: 'a summary\n' }]);

      const result = await runSteps([OPAQUE_STEP], undefined, {
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });

      expect(result.retained?.stdout.toString('utf8')).toBe('a summary\n');
      expect(result.retained?.stderr.toString('utf8')).toBe('a warning\n');
    });

    it('concatenates several opaque steps per stream in declaration order', async () => {
      stubSequence([0, 0], [{ stdout: 'first\n' }, { stdout: 'second\n' }]);

      const result = await runSteps([OPAQUE_STEP, { kind: 'opaque', command: 'vitest' }], undefined, {
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });

      expect(result.retained?.stdout.toString('utf8')).toBe('first\nsecond\n');
    });

    // A composite hands its descriptors to the nmr processes below it, and a destination carrying none makes
    // those steps piped like any other, so the kind is the only thing that separates them.
    it('given a list of structural steps alone, retains nothing even though they ran on pipes', async () => {
      stubSequence([0, 0], [{ stdout: 'a constituent verdict\n' }, { stdout: 'another verdict\n' }]);

      const result = await runSteps([STRUCTURAL_STEP, STRUCTURAL_STEP], undefined, {
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });

      expect(result.retained).toBeUndefined();
    });

    it('given hooks wrapped around the command, retains the command output alone', async () => {
      stubSequence([0, 0, 0], [{ stdout: 'before\n' }, { stdout: 'the command\n' }, { stdout: 'after\n' }]);

      const result = await runSteps(
        [
          { kind: 'structural', argv: ['nmr', 'check:pre'] },
          OPAQUE_STEP,
          { kind: 'structural', argv: ['nmr', 'check:post'] },
        ],
        undefined,
        { stderr: new PassThrough(), stdout: new PassThrough() },
      );

      expect(result.retained?.stdout.toString('utf8')).toBe('the command\n');
    });

    it('given a stream handed to the child as a descriptor, retains nothing', async () => {
      stubSequence([0], [{ stdout: 'a summary\n' }]);

      const result = await runSteps([OPAQUE_STEP], undefined, {
        stderr: createTerminalStream(),
        stdout: createTerminalStream(),
      });

      expect(result.retained).toBeUndefined();
    });

    it('given one opaque step captured and another handed a descriptor, retains nothing', async () => {
      let call = 0;
      mockedSpawn.mockImplementation((_file, _args, options) => {
        const stdio = Array.isArray(options.stdio) ? options.stdio : [];
        // The second step is the one whose stderr goes to a descriptor, which is a capture short of both streams.
        const isPartial = call === 1;
        call++;
        // eslint-disable-next-line unicorn/prefer-event-target -- the runner attaches EventEmitter listeners to the child.
        const fake = Object.assign(new EventEmitter(), {
          stdout: stdio[1] === 'pipe' ? new PassThrough() : null,
          stderr: isPartial || stdio[2] !== 'pipe' ? null : new PassThrough(),
        });
        setImmediate(() => {
          fake.stdout?.write('a summary\n');
          void endChild(fake, 0);
        });
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the runner reads only stdout, stderr, and the event methods, so the fake models those alone.
        return fake as unknown as ReturnType<typeof spawn>;
      });

      const result = await runSteps([OPAQUE_STEP, { kind: 'opaque', command: 'vitest' }], undefined, {
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });

      expect(result.retained).toBeUndefined();
    });

    it('given a failing step, still carries back what ran', async () => {
      stubSequence([1], [{ stdout: 'the failure\n' }]);

      const result = await runSteps([OPAQUE_STEP], undefined, {
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });

      expect(result.exitCode).toBe(1);
      expect(result.retained?.stdout.toString('utf8')).toBe('the failure\n');
    });
  });

  describe('quiet mode', () => {
    // Each process suppresses the output of the command it runs, never of the subtree beneath it: the nmr
    // process a structural step spawns does its own withholding, so this one forwards whatever reaches it.
    it('forwards a structural step even under quiet', async () => {
      const destination = new PassThrough();
      const received = collect(destination);
      mockedSpawn.mockImplementation((_file, _args, options) => {
        const stdio = Array.isArray(options.stdio) ? options.stdio : [];
        // eslint-disable-next-line unicorn/prefer-event-target -- the runner attaches EventEmitter listeners to the child.
        const fake = Object.assign(new EventEmitter(), {
          stdout: stdio[1] === 'pipe' ? new PassThrough() : null,
          stderr: stdio[2] === 'pipe' ? new PassThrough() : null,
        });
        setImmediate(() => {
          fake.stdout?.write('a child verdict\n');
          void endChild(fake, 0);
        });
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the runner reads only stdout, stderr, and the event methods, so the fake models those alone.
        return fake as unknown as ReturnType<typeof spawn>;
      });

      await runSteps([STRUCTURAL_STEP], undefined, {
        quiet: true,
        stderr: new PassThrough(),
        stdout: destination,
      });
      await flushEventLoop();

      expect(received().toString('utf8')).toBe('a child verdict\n');
    });

    it('surrenders the failing step alone, leaving an earlier step it already withheld unreported', async () => {
      const errorStream = new PassThrough();
      const reported = collect(errorStream);
      let index = 0;
      mockedSpawn.mockImplementation((_file, _args, options) => {
        const stdio = Array.isArray(options.stdio) ? options.stdio : [];
        // eslint-disable-next-line unicorn/prefer-event-target -- the runner attaches EventEmitter listeners to the child.
        const fake = Object.assign(new EventEmitter(), {
          stdout: stdio[1] === 'pipe' ? new PassThrough() : null,
          stderr: stdio[2] === 'pipe' ? new PassThrough() : null,
        });
        const step = index;
        index++;
        setImmediate(() => {
          fake.stdout?.write(step === 0 ? 'first step chatter\n' : 'second step failure\n');
          void endChild(fake, step === 0 ? 0 : 1);
        });
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the runner reads only stdout, stderr, and the event methods, so the fake models those alone.
        return fake as unknown as ReturnType<typeof spawn>;
      });

      const result = await runSteps([OPAQUE_STEP, { kind: 'opaque', command: 'vitest' }], undefined, {
        quiet: true,
        stderr: errorStream,
        stdout: new PassThrough(),
      });
      await flushEventLoop();

      expect(result.exitCode).toBe(1);
      expect(reported().toString('utf8')).toBe('second step failure\n');
    });
  });

  describe('spawn failure', () => {
    it('ends the sequence rather than running on to the next step', async () => {
      mockedSpawn.mockImplementation((_file, _args, options) => {
        const stdio = Array.isArray(options.stdio) ? options.stdio : [];
        // eslint-disable-next-line unicorn/prefer-event-target -- the runner attaches EventEmitter listeners to the child.
        const fake = Object.assign(new EventEmitter(), {
          stdout: stdio[1] === 'pipe' ? new PassThrough() : null,
          stderr: stdio[2] === 'pipe' ? new PassThrough() : null,
        });
        setImmediate(() => fake.emit('error', new Error('spawn nmr ENOENT')));
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the runner reads only stdout, stderr, and the event methods, so the fake models those alone.
        return fake as unknown as ReturnType<typeof spawn>;
      });

      const result = await runSteps([STRUCTURAL_STEP, OPAQUE_STEP], undefined, {
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });

      expect(result).toStrictEqual({ exitCode: 1 });
      expect(mockedSpawn).toHaveBeenCalledTimes(1);
    });
  });
});
