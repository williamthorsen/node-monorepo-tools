import { type ChildProcess, spawn } from 'node:child_process';
import os from 'node:os';
import process from 'node:process';
import type { Readable, Writable } from 'node:stream';

import { reportError } from '@williamthorsen/nmr-core';

import { createBoundedBuffer } from './helpers/createBoundedBuffer.ts';
import type { OutputChannels } from './output-channel.ts';

/** Exit codes that a shell reserves for a death by signal, offset by the signal number. */
const SIGNAL_EXIT_BASE = 128;

/** How long a completed command's pipes are given to drain before a descendant holding them open is abandoned. */
const PIPE_DRAIN_GRACE_MS = 2_000;

export interface RunCommandOptions {
  /** The channel on which each of the child's output streams runs. */
  channels: OutputChannels;
  /** When true, suppresses output on success and writes captured output to stderr on failure. */
  quiet?: boolean;
  /** Stream that subprocess stdout flows to in non-quiet mode. Defaults to `process.stdout`. */
  stdout?: Writable;
  /** Stream that subprocess stderr flows to (and that quiet-mode failure output is written to). Defaults to `process.stderr`. */
  stderr?: Writable;
  /** Environment for the subprocess. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

export type RunCommandResult = CommandCompletion & {
  /**
   * Output retained while the command ran, elided in the middle when it overran the bound.
   * `undefined` when the stream was handed to the child directly, or when capture stopped early
   * and the retained copy would understate what the command produced.
   */
  stdout: Buffer | undefined;
  stderr: Buffer | undefined;
};

/** What to hand `spawn`: a whole command line for a shell to parse, or a file and the arguments that it receives. */
export interface SpawnSpec {
  args: readonly string[];
  file: string;
  /** Whether the child reads nmr's own stdin or the null device. */
  input: 'ignore' | 'inherit';
  shouldUseShell: boolean;
}

/** A spawned child and a promise of how it ended. */
export interface StartedCommand {
  child: ChildProcess;
  result: Promise<RunCommandResult>;
}

/** Returns the exit code that a shell reports for a death by the signal. */
export function describeSignalExitCode(signal: NodeJS.Signals): number {
  return SIGNAL_EXIT_BASE + os.constants.signals[signal];
}

/** Spawns one child on the caller's channels, returning the child and a promise of how it ended. */
export function startSpawned(
  { args, file, input, shouldUseShell }: SpawnSpec,
  cwd: string | undefined,
  options: RunCommandOptions,
): StartedCommand {
  const quiet = options.quiet === true;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const env = options.env ?? process.env;

  const child = spawn(file, args, {
    shell: shouldUseShell,
    stdio: [input, options.channels.stdout, options.channels.stderr],
    cwd,
    env,
  });

  return { child, result: collectResult(child, { quiet, stderr, stdout }) };
}

// region | Helpers

/** How a command ended, and the exit code that reports that ending to nmr's own caller. */
type CommandCompletion =
  | { outcome: 'exited'; exitCode: number }
  | { outcome: 'signaled'; exitCode: number; signal: NodeJS.Signals }
  | { outcome: 'spawn-failed'; exitCode: number; error: Error };

/** Resolves once the child has ended, releasing pipes that a descendant holds open past the grace period. */
function awaitCompletion(child: ChildProcess, stopReading: () => void): Promise<CommandCompletion> {
  return new Promise((resolve) => {
    let exitCompletion: CommandCompletion | undefined;
    let graceTimer: NodeJS.Timeout | undefined;
    let isSettled = false;

    /** Resolves with the first completion reported, clearing the grace timer. */
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
      const exitDescription = describeExit(code, signal);
      exitCompletion = exitDescription;
      graceTimer = setTimeout(() => {
        stopReading();
        settle(exitDescription);
      }, PIPE_DRAIN_GRACE_MS);
    });

    child.on('close', () => {
      settle(exitCompletion ?? { outcome: 'exited', exitCode: 1 });
    });
  });
}

/** Consumes a child stream, forwarding it to a destination when there is one and retaining a bounded copy. */
function captureStream(
  source: Readable,
  destination: Writable | undefined,
): { readBuffer: () => Buffer | undefined; detach: () => void; stopReading: () => void } {
  const retainedCopy = createBoundedBuffer();
  let isComplete = true;

  /**
   * Stops consuming the source. Unpiping first releases the listeners that `pipe` registered on the
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
  source.on('data', (chunk: Buffer) => retainedCopy.append(chunk));

  return {
    readBuffer: () => (isComplete ? retainedCopy.readBuffer() : undefined),
    detach: () => {
      destination?.off('error', abandon);
    },
    stopReading,
  };
}

/** Captures a spawned child's piped streams and resolves with how it ended and what it wrote. */
async function collectResult(
  child: ChildProcess,
  { quiet, stderr, stdout }: { quiet: boolean; stderr: Writable; stdout: Writable },
): Promise<RunCommandResult> {
  // A stream handed to the child as a descriptor is null here, and nmr never sees a byte of it.
  const stdoutCapture = child.stdout === null ? undefined : captureStream(child.stdout, quiet ? undefined : stdout);
  const stderrCapture = child.stderr === null ? undefined : captureStream(child.stderr, quiet ? undefined : stderr);

  const commandCompletion = await awaitCompletion(child, () => {
    stdoutCapture?.stopReading();
    stderrCapture?.stopReading();
  });

  stdoutCapture?.detach();
  stderrCapture?.detach();

  const result: RunCommandResult = {
    ...commandCompletion,
    stdout: stdoutCapture?.readBuffer(),
    stderr: stderrCapture?.readBuffer(),
  };

  // A spawn failure does not have any captured output to forward, so quiet mode reports it rather than exiting 1
  // in silence.
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

/** Maps a child's exit status onto the code nmr propagates, so that a signal death is distinguishable from an exit. */
function describeExit(code: number | null, signal: NodeJS.Signals | null): CommandCompletion {
  if (signal !== null) {
    return { outcome: 'signaled', exitCode: describeSignalExitCode(signal), signal };
  }
  return { outcome: 'exited', exitCode: code ?? 1 };
}

/** Writes a retained buffer to the destination stream, skipping absent and empty payloads. */
function writeBuffer(buffer: Buffer | undefined, destination: Writable): void {
  if (buffer !== undefined && buffer.length > 0) destination.write(buffer);
}

// endregion | Helpers
