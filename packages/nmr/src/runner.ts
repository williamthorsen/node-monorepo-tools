import { type ChildProcess, spawn } from 'node:child_process';
import os from 'node:os';
import process from 'node:process';
import type { Readable, Writable } from 'node:stream';

import { reportError } from '@williamthorsen/nmr-core';

import { createBoundedBuffer } from './helpers/createBoundedBuffer.ts';
import { createOutputRecorder, type OutputRecorder } from './helpers/createOutputRecorder.ts';
import type { Step } from './steps.ts';

/** Exit codes that a shell reserves for a death by signal, offset by the signal number. */
const SIGNAL_EXIT_BASE = 128;

/** How long a completed command's pipes are given to drain before a descendant holding them open is abandoned. */
const PIPE_DRAIN_GRACE_MS = 2_000;

/** Where one of a child's output streams goes: a descriptor to which the child writes, or a pipe read by nmr. */
export type OutputChannel = number | 'pipe';

/** The channel on which each of a child's output streams runs. */
export interface OutputChannels {
  stderr: OutputChannel;
  stdout: OutputChannel;
}

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

/** What a step list needs to run. Each step's channels follow its kind, so the caller chooses none of them. */
export type RunStepsOptions = Omit<RunCommandOptions, 'channels'>;

/** A bounded copy of what a step list's own commands wrote, each stream kept apart from the other. */
export interface RetainedOutput {
  stderr: Buffer;
  stdout: Buffer;
}

export interface RunStepsResult {
  exitCode: number;
  /**
   * What the list's opaque steps produced, absent unless every one of them was captured whole and there was
   * at least one to capture.
   */
  retainedOutput?: RetainedOutput;
}

/** How a command ended, and the exit code that reports that ending to nmr's own caller. */
type CommandCompletion =
  | { outcome: 'exited'; exitCode: number }
  | { outcome: 'signaled'; exitCode: number; signal: NodeJS.Signals }
  | { outcome: 'spawn-failed'; exitCode: number; error: Error };

export type RunCommandResult = CommandCompletion & {
  /**
   * Output retained while the command ran, elided in the middle when it overran the bound.
   * `undefined` when the stream was handed to the child directly, or when capture stopped early
   * and the retained copy would understate what the command produced.
   */
  stdout: Buffer | undefined;
  stderr: Buffer | undefined;
};

/**
 * Returns the channel on which a stream runs: the stream's own descriptor when it is a terminal and output is
 * not being withheld, so that the child's terminal detection matches nmr's, and a pipe everywhere else.
 */
export function resolveChannel(stream: Writable, quiet: boolean): OutputChannel {
  if (quiet) return 'pipe';
  return isTerminal(stream) ? stream.fd : 'pipe';
}

/**
 * Returns the channel for a step that runs an nmr process below this one: nmr's own descriptor whenever it has
 * one, so that the child writes where nmr writes, without an ancestor between them relaying bytes. A stream
 * without a descriptor falls back to a pipe.
 */
export function resolveInheritedChannel(stream: Writable): OutputChannel {
  return hasDescriptor(stream) ? stream.fd : 'pipe';
}

/**
 * Runs a step list in order and resolves once one fails or all have run, implementing the `&&` semantics that
 * nmr promises: The first non-zero exit ends the sequence and is the code returned.
 *
 * Sequencing here rather than in a spawned shell lets each step run on the channels that its kind calls for, and
 * makes a signal to nmr end the run: The steps after it are never reached, whereas a shell would have gone on
 * running them unsupervised.
 *
 * A background step is started and left running while the steps after it run. Its output is recorded rather
 * than streamed, and printed whole at the first step boundary after it ends, so that it never interleaves with
 * another step's. A failing foreground step still ends the sequence, but the list waits for every background step
 * that it started and reports the first failure among them when the foreground did not fail. While a background
 * step runs, a SIGINT or SIGTERM to nmr is forwarded to every running child, so that a signal sent to nmr alone
 * still ends the children.
 *
 * Returns a bounded copy of what the list's own commands wrote, so that a caller can retain it. Only opaque
 * steps contribute: A structural step is another nmr process reporting for the subtree beneath it, and its
 * output is that subtree's to account for.
 */
export async function runSteps(
  steps: readonly Step[],
  cwd: string | undefined,
  options: RunStepsOptions,
): Promise<RunStepsResult> {
  const resolvedOptions = {
    ...options,
    quiet: options.quiet === true,
    stdout: options.stdout ?? process.stdout,
    stderr: options.stderr ?? process.stderr,
  };

  const parts: RetainedOutput[] = [];
  let isCaptureWhole = true;
  const backgroundRuns: BackgroundRun[] = [];
  const runningChildren = new Set<ChildProcess>();
  let receivedSignal: NodeJS.Signals | undefined;
  let foregroundExitCode = 0;

  /** Forwards a signal sent to nmr to every running child, and stops the sequence from starting another step. */
  function forwardSignal(signal: NodeJS.Signals): void {
    receivedSignal ??= signal;
    for (const child of runningChildren) child.kill(signal);
  }

  /** Starts a step and tracks its child until the child exits. */
  function launch(step: Step, launchOptions: typeof resolvedOptions): StartedCommand {
    const started = startStep(step, cwd, launchOptions);
    runningChildren.add(started.child);
    void started.result.finally(() => runningChildren.delete(started.child));
    return started;
  }

  /** Prints the output of every background step that has ended and not been printed. */
  function flushEndedBackgroundRuns(): void {
    for (const run of backgroundRuns) {
      if (run.result === undefined || run.isFlushed) continue;
      run.recorder.replay({ stderr: resolvedOptions.stderr, stdout: resolvedOptions.stdout });
      run.isFlushed = true;
    }
  }

  try {
    for (const step of steps) {
      if (receivedSignal !== undefined) {
        foregroundExitCode = describeSignalExitCode(receivedSignal);
        break;
      }

      if (step.kind === 'structural' && step.shouldRunInBackground === true) {
        if (backgroundRuns.length === 0) {
          process.on('SIGINT', forwardSignal);
          process.on('SIGTERM', forwardSignal);
        }
        backgroundRuns.push(startBackgroundRun(step, resolvedOptions, launch));
        continue;
      }

      const result = await launch(step, resolvedOptions).result;
      flushEndedBackgroundRuns();

      // Read from the step's kind rather than from whether the child handed back a pipe. A structural step runs
      // on inherited descriptors, but a destination without one falls back to a pipe and is captured like any
      // other, which would let a composite's constituents and a `:pre`/`:post` hook contribute output of their
      // own.
      if (step.kind === 'opaque') {
        if (result.stderr === undefined || result.stdout === undefined) {
          isCaptureWhole = false;
        } else {
          parts.push({ stderr: result.stderr, stdout: result.stdout });
        }
      }

      if (result.exitCode !== 0) {
        foregroundExitCode = result.exitCode;
        if (result.outcome === 'signaled') {
          for (const run of backgroundRuns) run.child.kill(result.signal);
        }
        break;
      }
    }

    for (const run of backgroundRuns) {
      await run.settled;
      flushEndedBackgroundRuns();
    }
  } finally {
    process.off('SIGINT', forwardSignal);
    process.off('SIGTERM', forwardSignal);
  }

  const exitCode = selectExitCode(foregroundExitCode, receivedSignal, backgroundRuns);
  return { exitCode, ...composeRetainedOutput(parts, isCaptureWhole) };
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
 * Because piped stdout and stderr are ordered by arrival rather than by a shared descriptor, their interleaving
 * is approximate.
 */
export async function runCommand(
  command: string,
  cwd: string | undefined,
  options: RunCommandOptions,
): Promise<RunCommandResult> {
  return runSpawned({ args: [], file: command, input: 'inherit', shouldUseShell: true }, cwd, options);
}

// region | Helpers

/** A background step that has been started, with its recorded output and, once it has ended, its result. */
interface BackgroundRun {
  child: ChildProcess;
  isFlushed: boolean;
  recorder: OutputRecorder;
  result: RunCommandResult | undefined;
  /** Resolves once the step has ended and `result` is set. */
  settled: Promise<void>;
}

/** The options of a step list once each stream has been given its default. */
type ResolvedStepsOptions = RunStepsOptions & { quiet: boolean; stderr: Writable; stdout: Writable };

/** A spawned child and a promise of how it ended. */
interface StartedCommand {
  child: ChildProcess;
  result: Promise<RunCommandResult>;
}

/** What to hand `spawn`: a whole command line for a shell to parse, or a file and the arguments that it receives. */
interface SpawnSpec {
  args: readonly string[];
  file: string;
  /** Whether the child reads nmr's own stdin or the null device. */
  input: 'ignore' | 'inherit';
  shouldUseShell: boolean;
}

/** Spawns one child on the caller's channels and resolves once it has ended. */
function runSpawned(spec: SpawnSpec, cwd: string | undefined, options: RunCommandOptions): Promise<RunCommandResult> {
  return startSpawned(spec, cwd, options).result;
}

/** Spawns one child on the caller's channels, returning the child and a promise of how it ended. */
function startSpawned(
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

/**
 * Starts one step on the channels that its kind calls for.
 *
 * A structural step runs loud whatever mode this process is in: The nmr process underneath suppresses the
 * output of the command that it runs, and an ancestor withholding it as well would be suppressing the subtree.
 */
function startStep(step: Step, cwd: string | undefined, options: ResolvedStepsOptions): StartedCommand {
  const { quiet, stderr, stdout } = options;

  if (step.kind === 'opaque') {
    return startSpawned({ args: [], file: step.command, input: 'inherit', shouldUseShell: true }, cwd, {
      ...options,
      channels: { stderr: resolveChannel(stderr, quiet), stdout: resolveChannel(stdout, quiet) },
    });
  }

  const [file, ...args] = step.argv;
  const input = step.shouldWithholdInput === true ? 'ignore' : 'inherit';
  return startSpawned({ args, file, input, shouldUseShell: false }, cwd, {
    ...options,
    quiet: false,
    channels: { stderr: resolveInheritedChannel(stderr), stdout: resolveInheritedChannel(stdout) },
  });
}

/**
 * Concatenates in declaration order what each opaque step retained, or reports none when a step's capture fell
 * short of both streams or when the list did not contain any opaque step.
 *
 * A partial capture is reported as none rather than as what was gathered, which would understate the run.
 */
function composeRetainedOutput(
  parts: readonly RetainedOutput[],
  isCaptureWhole: boolean,
): { retainedOutput?: RetainedOutput } {
  if (!isCaptureWhole || parts.length === 0) {
    return {};
  }

  return {
    retainedOutput: {
      stderr: Buffer.concat(parts.map((part) => part.stderr)),
      stdout: Buffer.concat(parts.map((part) => part.stdout)),
    },
  };
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

/**
 * Returns the environment for a background step: nmr's own, with `FORCE_COLOR` added when nmr writes to a
 * terminal, so that a tool writing to the recorder's pipe colours its output as it would at the terminal on
 * which the output is printed. `NO_COLOR` and an inherited `FORCE_COLOR` are left to decide for themselves.
 */
function buildBackgroundEnv(options: ResolvedStepsOptions): NodeJS.ProcessEnv {
  const env = options.env ?? process.env;
  const shouldForceColor =
    isTerminal(options.stdout) && (env['NO_COLOR'] ?? '') === '' && env['FORCE_COLOR'] === undefined;
  return shouldForceColor ? { ...env, FORCE_COLOR: '1' } : env;
}

/** Maps a child's exit status onto the code nmr propagates, so that a signal death is distinguishable from an exit. */
function describeExit(code: number | null, signal: NodeJS.Signals | null): CommandCompletion {
  if (signal !== null) {
    return { outcome: 'signaled', exitCode: describeSignalExitCode(signal), signal };
  }
  return { outcome: 'exited', exitCode: code ?? 1 };
}

/** Returns the exit code that a shell reports for a death by the signal. */
function describeSignalExitCode(signal: NodeJS.Signals): number {
  return SIGNAL_EXIT_BASE + os.constants.signals[signal];
}

/** Narrows a stream to one with a descriptor that a child can be handed, terminal or not. */
function hasDescriptor(stream: Writable): stream is Writable & { fd: number } {
  return 'fd' in stream && typeof stream.fd === 'number';
}

/** Narrows a stream to one backed by a terminal, whose descriptor the child can be handed. */
function isTerminal(stream: Writable): stream is Writable & { fd: number } {
  return 'isTTY' in stream && stream.isTTY === true && hasDescriptor(stream);
}

/** Sets a background run's result once its step has ended. */
async function recordResult(run: BackgroundRun, result: Promise<RunCommandResult>): Promise<void> {
  run.result = await result;
}

/**
 * Returns the code that a step list reports: the failing foreground step's, else the code of a signal that nmr
 * received, else the first failing background step's in declaration order.
 */
function selectExitCode(
  foregroundExitCode: number,
  receivedSignal: NodeJS.Signals | undefined,
  backgroundRuns: readonly BackgroundRun[],
): number {
  if (foregroundExitCode !== 0) return foregroundExitCode;
  if (receivedSignal !== undefined) return describeSignalExitCode(receivedSignal);
  return backgroundRuns.find((run) => run.result !== undefined && run.result.exitCode !== 0)?.result?.exitCode ?? 0;
}

/**
 * Starts a background step with its output recorded and its stdin withheld, since a sibling running in the
 * foreground may read nmr's own.
 */
function startBackgroundRun(
  step: Step & { kind: 'structural' },
  options: ResolvedStepsOptions,
  launch: (step: Step, options: ResolvedStepsOptions) => StartedCommand,
): BackgroundRun {
  const recorder = createOutputRecorder();
  const started = launch(
    { ...step, shouldWithholdInput: true },
    { ...options, env: buildBackgroundEnv(options), stderr: recorder.stderr, stdout: recorder.stdout },
  );
  const run: BackgroundRun = {
    child: started.child,
    isFlushed: false,
    recorder,
    result: undefined,
    settled: Promise.resolve(),
  };
  run.settled = recordResult(run, started.result);
  return run;
}

/** Writes a retained buffer to the destination stream, skipping absent and empty payloads. */
function writeBuffer(buffer: Buffer | undefined, destination: Writable): void {
  if (buffer !== undefined && buffer.length > 0) destination.write(buffer);
}

// endregion | Helpers
