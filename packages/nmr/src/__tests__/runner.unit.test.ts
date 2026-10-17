import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OutputChannels } from '../output-channel.ts';
import { runCommand } from '../runner.ts';
import { collect, endChild, type FakeChild, flushEventLoop, readStdioFromCall } from '../test-utils/fake-spawn.ts';

vi.mock(import('node:child_process'), () => ({
  spawn: vi.fn(),
}));

const mockedSpawn = vi.mocked(spawn);

/** What a caller writing to a non-terminal destination resolves, which is the arrangement that most of these tests model. */
const PIPED_CHANNELS: OutputChannels = { stderr: 'pipe', stdout: 'pipe' };

describe(runCommand, () => {
  beforeEach(() => {
    mockedSpawn.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('stream routing', () => {
    it('runs each stream on the channel that the caller chose', async () => {
      const getChild = stubSpawn();

      const pendingRun = runCommand('cmd', undefined, {
        channels: { stderr: 2, stdout: 'pipe' },
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });
      await endChild(getChild());
      await pendingRun;

      expect(readStdioFromCall().slice(1)).toStrictEqual(['pipe', 2]);
    });

    it('given a descriptor channel, does not retain a copy of that stream', async () => {
      const getChild = stubSpawn();

      const pendingRun = runCommand('cmd', undefined, {
        channels: { stderr: 'pipe', stdout: 1 },
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });
      await endChild(getChild());
      const result = await pendingRun;

      expect(result.stdout).toBeUndefined();
    });

    it('inherits stdin so that an interactive command keeps its input', async () => {
      const getChild = stubSpawn();

      const pendingRun = runCommand('cmd', undefined, {
        channels: PIPED_CHANNELS,
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });
      await endChild(getChild());
      await pendingRun;

      expect(readStdioFromCall()[0]).toBe('inherit');
    });

    it('passes caller-supplied env and cwd to spawn', async () => {
      const getChild = stubSpawn();

      const pendingRun = runCommand('echo $FOO', '/tmp', {
        channels: PIPED_CHANNELS,
        env: { FOO: 'bar' },
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });
      await endChild(getChild());
      await pendingRun;

      expect(mockedSpawn.mock.calls[0]?.[2]).toMatchObject({ cwd: '/tmp', env: { FOO: 'bar' }, shell: true });
    });
  });

  describe('forwarding', () => {
    it('forwards a chunk before the command exits', async () => {
      const getChild = stubSpawn();
      const destination = new PassThrough();
      const received = collect(destination);

      const pendingRun = runCommand('cmd', undefined, {
        channels: PIPED_CHANNELS,
        stderr: new PassThrough(),
        stdout: destination,
      });
      const child = getChild();
      requireStdout(child).write('first');
      await flushEventLoop();

      expect(received().toString('utf8')).toBe('first');

      await endChild(child);
      await pendingRun;
    });

    it('when the destination applies back-pressure, pauses the child stream until it drains', async () => {
      const getChild = stubSpawn();
      const { release, stream } = createBlockingStream();

      const pendingRun = runCommand('cmd', undefined, {
        channels: PIPED_CHANNELS,
        stderr: new PassThrough(),
        stdout: stream,
      });
      const child = getChild();
      // eslint-disable-next-line sky-pilot/no-floating-disposable -- the child owns this stream; requireStdout only narrows child.stdout
      const childStdout = requireStdout(child);
      childStdout.write('a'.repeat(64));
      await flushEventLoop();

      expect(childStdout.isPaused()).toBe(true);

      release();
      await flushEventLoop();

      expect(childStdout.isPaused()).toBe(false);

      await endChild(child);
      await pendingRun;
    });

    it('does not end a caller-supplied destination, so a later command can still write to it', async () => {
      const getChild = stubSpawn();
      const destination = new PassThrough();

      const pendingRun = runCommand('cmd', undefined, {
        channels: PIPED_CHANNELS,
        stderr: new PassThrough(),
        stdout: destination,
      });
      await endChild(getChild());
      await pendingRun;

      expect(destination.writableEnded).toBe(false);
      expect(destination.write('later')).toBe(true);
    });

    it('when output exceeds the retained bound, forwards every byte that the command produced', async () => {
      const getChild = stubSpawn();
      const destination = new PassThrough();
      const received = collect(destination);
      const producedBuffer = Buffer.alloc(3_000_000, 'a');

      const pendingRun = runCommand('cmd', undefined, {
        channels: PIPED_CHANNELS,
        stderr: new PassThrough(),
        stdout: destination,
      });
      const child = getChild();
      requireStdout(child).write(producedBuffer);
      const result = await (async () => {
        await endChild(child);
        return pendingRun;
      })();

      expect(received()).toHaveLength(producedBuffer.length);
      expect(result.stdout?.length).toBeLessThan(producedBuffer.length);
    });
  });

  describe('destination failure', () => {
    it('when the destination errors, destroys the child stream and reports the capture as incomplete', async () => {
      const getChild = stubSpawn();
      const destination = new PassThrough();

      const pendingRun = runCommand('cmd', undefined, {
        channels: PIPED_CHANNELS,
        stderr: new PassThrough(),
        stdout: destination,
      });
      const child = getChild();
      // eslint-disable-next-line sky-pilot/no-floating-disposable -- the child owns this stream; requireStdout only narrows child.stdout
      const childStdout = requireStdout(child);
      destination.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
      await flushEventLoop();

      expect(childStdout.destroyed).toBe(true);

      child.emit('exit', 0, null);
      child.emit('close');
      const result = await pendingRun;

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBeUndefined();
    });
  });

  describe('outcome', () => {
    it('when the command exits non-zero, returns that code', async () => {
      const getChild = stubSpawn();

      const pendingRun = runCommand('failing-command', undefined, {
        channels: PIPED_CHANNELS,
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });
      await endChild(getChild(), 2);

      await expect(pendingRun).resolves.toMatchObject({ exitCode: 2, outcome: 'exited' });
    });

    it('when the command dies by signal, returns 128 plus the signal number', async () => {
      const getChild = stubSpawn();

      const pendingRun = runCommand('killed-command', undefined, {
        channels: PIPED_CHANNELS,
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });
      await endChild(getChild(), null, 'SIGTERM');

      await expect(pendingRun).resolves.toMatchObject({ exitCode: 143, outcome: 'signaled', signal: 'SIGTERM' });
    });

    it('when the spawn fails, returns 1 and writes the error line to the error stream', async () => {
      const getChild = stubSpawn();
      const errorStream = new PassThrough();
      const reported = collect(errorStream);

      const pendingRun = runCommand('nonexistent-bin', undefined, {
        channels: PIPED_CHANNELS,
        stderr: errorStream,
        stdout: new PassThrough(),
      });
      getChild().emit('error', new Error('spawn /bin/sh ENOENT'));
      const result = await pendingRun;
      await flushEventLoop();

      expect(result).toMatchObject({ exitCode: 1, outcome: 'spawn-failed' });
      expect(reported().toString('utf8')).toBe('Error: spawn /bin/sh ENOENT\n');
    });

    it('when a descendant holds the pipe open, resolves on the exit status after the grace period', async () => {
      const getChild = stubSpawn();
      const destination = new PassThrough();
      const received = collect(destination);

      const pendingRun = runCommand('cmd', undefined, {
        channels: PIPED_CHANNELS,
        stderr: new PassThrough(),
        stdout: destination,
      });
      const child = getChild();
      requireStdout(child).write('produced');
      await flushEventLoop();
      // `close` never arrives: The descendant still holds the write end of the pipe.
      child.emit('exit', 3, null);
      const result = await pendingRun;

      expect(result).toMatchObject({ exitCode: 3, outcome: 'exited' });
      expect(requireStdout(child).destroyed).toBe(true);
      expect(received().toString('utf8')).toBe('produced');
      // What the command wrote before exiting is its whole output, so the runner keeps the retained copy.
      expect(result.stdout?.toString('utf8')).toBe('produced');
    }, 20_000);

    it('when a descendant holds the pipe open, does not leave any pipe listeners on a shared destination', async () => {
      vi.useFakeTimers();
      const destination = new PassThrough();
      destination.resume();

      for (let run = 0; run < 3; run++) {
        const getChild = stubSpawn();
        const pendingRun = runCommand('cmd', undefined, {
          channels: PIPED_CHANNELS,
          stderr: new PassThrough(),
          stdout: destination,
        });
        getChild().emit('exit', 0, null);
        await vi.advanceTimersByTimeAsync(2_000);
        await pendingRun;
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

      const pendingRun = runCommand('cmd', undefined, {
        channels: PIPED_CHANNELS,
        quiet: true,
        stderr: errorStream,
        stdout: new PassThrough(),
      });
      const child = getChild();
      requireStdout(child).write('some output');
      await endChild(child);
      await pendingRun;
      await flushEventLoop();

      expect(reported()).toHaveLength(0);
    });

    it('writes retained stdout then stderr to the error stream when the command fails', async () => {
      const getChild = stubSpawn();
      const errorStream = new PassThrough();
      const reported = collect(errorStream);

      const pendingRun = runCommand('lint', undefined, {
        channels: PIPED_CHANNELS,
        quiet: true,
        stderr: errorStream,
        stdout: new PassThrough(),
      });
      const child = getChild();
      requireStdout(child).write('lint errors\n');
      child.stderr?.write('error details\n');
      await endChild(child, 1);
      await pendingRun;
      await flushEventLoop();

      expect(reported().toString('utf8')).toBe('lint errors\nerror details\n');
    });
  });
});

// region | Helpers

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

/** Returns the child's stdout pipe, failing the test when the runner chose a descriptor instead. */
function requireStdout(child: FakeChild): PassThrough {
  if (child.stdout === null) throw new Error('Expected the runner to pipe stdout');
  return child.stdout;
}

/**
 * Installs a spawn mock whose child mirrors the stdio that the runner asked for: a pipe becomes a `PassThrough`,
 * a descriptor becomes `null`, exactly as `child_process` behaves.
 */
function stubSpawn(): () => FakeChild {
  let child: FakeChild | undefined;

  mockedSpawn.mockImplementation((_command, _args, options) => {
    const stdio = Array.isArray(options.stdio) ? options.stdio : [];
    // eslint-disable-next-line unicorn/prefer-event-target -- the runner attaches EventEmitter listeners to the child.
    const fakeChild = Object.assign(new EventEmitter(), {
      stdout: stdio[1] === 'pipe' ? new PassThrough() : null,
      stderr: stdio[2] === 'pipe' ? new PassThrough() : null,
    });
    child = fakeChild;
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the fake models only what the runner reads: stdout, stderr, and the event methods.
    return fakeChild as unknown as ReturnType<typeof spawn>;
  });

  return () => {
    if (child === undefined) throw new Error('spawn was not called');
    return child;
  };
}

// endregion | Helpers
