import type { ChildProcess } from 'node:child_process';
import process from 'node:process';
import type { Writable } from 'node:stream';

import {
  describeSignalExitCode,
  type RunCommandOptions,
  type RunCommandResult,
  type SpawnSpec,
  type StartedCommand,
  startSpawned,
} from './child-process.ts';
import { createOutputRecorder, type OutputRecorder } from './helpers/createOutputRecorder.ts';
import { isTerminal, resolveChannel, resolveInheritedChannel } from './output-channel.ts';
import type { Step } from './steps.ts';

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

/** Spawns one child on the caller's channels and resolves once it has ended. */
function runSpawned(spec: SpawnSpec, cwd: string | undefined, options: RunCommandOptions): Promise<RunCommandResult> {
  return startSpawned(spec, cwd, options).result;
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

// endregion | Helpers
