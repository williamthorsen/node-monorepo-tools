import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCommand } from '../runner.ts';

vi.mock(import('node:child_process'), () => ({
  spawn: vi.fn(),
}));

const mockedSpawn = vi.mocked(spawn);

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

describe(runCommand, () => {
  beforeEach(() => {
    mockedSpawn.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('stream routing', () => {
    it.each([
      { channel: 1, isQuiet: false, scenario: 'a terminal destination in loud mode', useTerminal: true },
      { channel: 'pipe', isQuiet: false, scenario: 'a piped destination in loud mode', useTerminal: false },
      { channel: 'pipe', isQuiet: true, scenario: 'a terminal destination in quiet mode', useTerminal: true },
    ])('given $scenario, uses $channel for stdout', async ({ channel, isQuiet, useTerminal }) => {
      const getChild = stubSpawn();
      const destination = useTerminal ? createTerminalStream() : new PassThrough();

      const pending = runCommand('cmd', undefined, { quiet: isQuiet, stderr: new PassThrough(), stdout: destination });
      await endChild(getChild());
      await pending;

      expect(stdioFromCall()[1]).toBe(channel);
    });

    it('inherits stdin so an interactive command keeps its input', async () => {
      const getChild = stubSpawn();

      const pending = runCommand('cmd', undefined, { stderr: new PassThrough(), stdout: new PassThrough() });
      await endChild(getChild());
      await pending;

      expect(stdioFromCall()[0]).toBe('inherit');
    });

    it('passes caller-supplied env and cwd to spawn', async () => {
      const getChild = stubSpawn();

      const pending = runCommand('echo $FOO', '/tmp', {
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

      const pending = runCommand('cmd', undefined, { stderr: new PassThrough(), stdout: destination });
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

      const pending = runCommand('cmd', undefined, { stderr: new PassThrough(), stdout: stream });
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

      const pending = runCommand('cmd', undefined, { stderr: new PassThrough(), stdout: destination });
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

      const pending = runCommand('cmd', undefined, { stderr: new PassThrough(), stdout: destination });
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

      const pending = runCommand('cmd', undefined, { stderr: new PassThrough(), stdout: destination });
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
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });
      await endChild(getChild(), 2);

      await expect(pending).resolves.toMatchObject({ exitCode: 2, outcome: 'exited' });
    });

    it('when the command dies by signal, returns 128 plus the signal number', async () => {
      const getChild = stubSpawn();

      const pending = runCommand('killed-command', undefined, {
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

      const pending = runCommand('nonexistent-bin', undefined, { stderr: errorStream, stdout: new PassThrough() });
      getChild().emit('error', new Error('spawn /bin/sh ENOENT'));
      const result = await pending;
      await flushEventLoop();

      expect(result).toMatchObject({ exitCode: 1, outcome: 'spawn-failed' });
      expect(reported().toString('utf8')).toBe('Error: spawn /bin/sh ENOENT\n');
    });

    it('when a descendant holds the pipe open, resolves on the exit status after the grace period', async () => {
      vi.useFakeTimers();
      const getChild = stubSpawn();

      const pending = runCommand('cmd', undefined, { stderr: new PassThrough(), stdout: new PassThrough() });
      const child = getChild();
      // `close` never arrives: the descendant still holds the write end of the pipe.
      child.emit('exit', 3, null);
      await vi.advanceTimersByTimeAsync(2_000);

      await expect(pending).resolves.toMatchObject({ exitCode: 3, outcome: 'exited' });
      expect(requireStdout(child).destroyed).toBe(true);
    });
  });

  describe('quiet mode', () => {
    it('writes nothing when the command succeeds', async () => {
      const getChild = stubSpawn();
      const errorStream = new PassThrough();
      const reported = collect(errorStream);

      const pending = runCommand('cmd', undefined, { quiet: true, stderr: errorStream, stdout: new PassThrough() });
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

      const pending = runCommand('lint', undefined, { quiet: true, stderr: errorStream, stdout: new PassThrough() });
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
