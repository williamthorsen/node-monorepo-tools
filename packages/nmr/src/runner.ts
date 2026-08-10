import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import os from 'node:os';
import process from 'node:process';
import type { Readable, Writable } from 'node:stream';

import { reportError } from '@williamthorsen/nmr-core';

import { createBoundedBuffer } from './helpers/createBoundedBuffer.ts';

/** Exit codes a shell reserves for a death by signal, offset by the signal number. */
const SIGNAL_EXIT_BASE = 128;

/** How long a completed command's pipes are given to drain before a descendant holding them open is abandoned. */
const PIPE_DRAIN_GRACE_MS = 2_000;

/** Where one of a child's output streams goes: a descriptor the child writes to, or a pipe nmr reads. */
export type OutputChannel = number | 'pipe';

/** The channel each of a child's output streams runs on. */
export interface OutputChannels {
  stderr: OutputChannel;
  stdout: OutputChannel;
}

export interface RunCommandOptions {
  /** The channel each of the child's output streams runs on. */
  channels: OutputChannels;
  /** When true, suppress output on success and write captured output to stderr on failure. */
  quiet?: boolean;
  /** Stream that subprocess stdout flows to in non-quiet mode. Defaults to `process.stdout`. */
  stdout?: Writable;
  /** Stream that subprocess stderr flows to (and that quiet-mode failure output is written to). Defaults to `process.stderr`. */
  stderr?: Writable;
  /** Environment for the subprocess. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/** How a command ended, and the exit code that carries that ending to nmr's own caller. */
type CommandCompletion =
  | { outcome: 'exited'; exitCode: number }
  | { outcome: 'signaled'; exitCode: number; signal: NodeJS.Signals }
  | { outcome: 'spawn-failed'; exitCode: number; error: Error };

export type RunCommandResult = CommandCompletion & {
  /**
   * Output retained while the command ran, elided in the middle when it overran the bound.
   * `undefined` where the stream was handed to the child directly, or where capture stopped early
   * and the retained copy would understate what the command produced.
   */
  stdout: Buffer | undefined;
  stderr: Buffer | undefined;
};

/**
 * Returns the channel a stream runs on: the stream's own descriptor when it is a terminal and output is not
 * being withheld, so the child's terminal detection matches nmr's, and a pipe everywhere else.
 */
export function resolveChannel(stream: Writable, quiet: boolean): OutputChannel {
  if (quiet) return 'pipe';
  return isTerminal(stream) ? stream.fd : 'pipe';
}

/**
 * Runs a command through a shell and resolves once it has ended.
 *
 * The caller chooses each stream's channel. A descriptor is handed to the child and nmr sees none of what
 * flows through it; a pipe is forwarded to the matching option stream as it arrives, with that destination's
 * back-pressure throttling the child, and a bounded copy is retained. Quiet mode withholds the forwarding,
 * discarding the retained copy on success and writing it to `options.stderr` on failure, so it has nothing to
 * report unless the caller chose a pipe on both streams.
 *
 * Piped stdout and stderr are ordered by arrival rather than by a shared descriptor, so their interleaving
 * is approximate.
 */
export async function runCommand(
  command: string,
  cwd: string | undefined,
  options: RunCommandOptions,
): Promise<RunCommandResult> {
  const quiet = options.quiet === true;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const env = options.env ?? process.env;

  const child = spawn(command, [], {
    shell: true,
    stdio: ['inherit', options.channels.stdout, options.channels.stderr],
    cwd,
    env,
  });

  // A stream handed to the child as a descriptor is null here, and nmr never sees a byte of it.
  const stdoutCapture = child.stdout === null ? undefined : captureStream(child.stdout, quiet ? undefined : stdout);
  const stderrCapture = child.stderr === null ? undefined : captureStream(child.stderr, quiet ? undefined : stderr);

  const completion = await awaitCompletion(child, () => {
    stdoutCapture?.stopReading();
    stderrCapture?.stopReading();
  });

  stdoutCapture?.detach();
  stderrCapture?.detach();

  const result: RunCommandResult = {
    ...completion,
    stdout: stdoutCapture?.toBuffer(),
    stderr: stderrCapture?.toBuffer(),
  };

  // A spawn failure has no captured output to forward, so quiet mode reports it rather than exiting 1 in silence.
  if (result.outcome === 'spawn-failed') {
    reportError(result.error.message, stderr);
    return result;
  }

  if (quiet && result.exitCode !== 0) {
    writeBuffer(result.stdout, stderr);
    writeBuffer(result.stderr, stderr);
  }

  return result;
}

// region | Helpers

/** Consumes a child stream, forwarding it to a destination when there is one and retaining a bounded copy. */
function captureStream(
  source: Readable,
  destination: Writable | undefined,
): { toBuffer: () => Buffer | undefined; detach: () => void; stopReading: () => void } {
  const retained = createBoundedBuffer();
  let isComplete = true;

  /**
   * Stops consuming the source. Unpiping first is what releases the listeners `pipe` registered on the
   * destination; `destroy` alone leaves them attached, and a shared destination accumulates a set per run.
   */
  function stopReading(): void {
    if (destination !== undefined) source.unpipe(destination);
    source.destroy();
  }

  /** Stops reading and reports the retained copy as absent, since it would understate the command's output. */
  function abandon(): void {
    isComplete = false;
    stopReading();
  }

  source.on('error', abandon);
  if (destination !== undefined) {
    // Closing the read end hands the child an EPIPE of its own, so `nmr <command> | head` ends the run
    // rather than letting the command write on into a destination that has gone away.
    destination.on('error', abandon);
    source.pipe(destination, { end: false });
  }
  source.on('data', (chunk: Buffer) => retained.append(chunk));

  return {
    toBuffer: () => (isComplete ? retained.toBuffer() : undefined),
    detach: () => {
      destination?.off('error', abandon);
    },
    stopReading,
  };
}

/** Resolves once the child has ended, releasing pipes a descendant holds open past the grace period. */
function awaitCompletion(child: ChildProcess, stopReading: () => void): Promise<CommandCompletion> {
  return new Promise((resolve) => {
    let exitCompletion: CommandCompletion | undefined;
    let graceTimer: NodeJS.Timeout | undefined;
    let isSettled = false;

    function settle(completion: CommandCompletion): void {
      if (isSettled) return;
      isSettled = true;
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      resolve(completion);
    }

    child.on('error', (error: Error) => {
      settle({ outcome: 'spawn-failed', exitCode: 1, error });
    });

    child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      const completion = describeExit(code, signal);
      exitCompletion = completion;
      graceTimer = setTimeout(() => {
        stopReading();
        settle(completion);
      }, PIPE_DRAIN_GRACE_MS);
    });

    child.on('close', () => {
      settle(exitCompletion ?? { outcome: 'exited', exitCode: 1 });
    });
  });
}

/** Maps a child's exit status onto the code nmr propagates, so a signal death is distinguishable from an exit. */
function describeExit(code: number | null, signal: NodeJS.Signals | null): CommandCompletion {
  if (signal !== null) {
    return { outcome: 'signaled', exitCode: SIGNAL_EXIT_BASE + os.constants.signals[signal], signal };
  }
  return { outcome: 'exited', exitCode: code ?? 1 };
}

/** Narrows a stream to one backed by a terminal, whose descriptor the child can be handed. */
function isTerminal(stream: Writable): stream is Writable & { fd: number } {
  return 'isTTY' in stream && stream.isTTY === true && 'fd' in stream && typeof stream.fd === 'number';
}

/** Writes a retained buffer to the destination stream, skipping absent and empty payloads. */
function writeBuffer(buffer: Buffer | undefined, destination: Writable): void {
  if (buffer !== undefined && buffer.length > 0) destination.write(buffer);
}

// endregion | Helpers
