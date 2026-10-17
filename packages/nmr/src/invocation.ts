import type { Writable } from 'node:stream';

import { resolveSelfVersion, type StreamStyles } from '@williamthorsen/nmr-core';

import type { TreeSnapshot } from './check-cache.ts';
import type { ResolvedContext } from './context.ts';
import type { ParsedArgs } from './invocation-args.ts';
import type { ReportFormat } from './report-format.ts';
import type { RunStepsOptions } from './runner.ts';
import type { Step } from './steps.ts';
import type { CommandVerbosity } from './verbosity.ts';

/** An invocation that reached a command: what it asks for, how it presents itself, and where it runs. */
export interface Invocation {
  anchorDir: string;
  command: string;
  context: ResolvedContext;
  cwd: string;
  env: NodeJS.ProcessEnv;
  format: ReportFormat;
  parsedArgs: ParsedArgs;
  scope: string;
  shouldUseRoot: boolean;
  stderr: Writable;
  stdout: Writable;
  styles: StreamStyles;
  verbosity: CommandVerbosity;
}

/** Either the outcome with which a phase settled the invocation, or the input of the next phase. */
export type PhaseResult<T> = { settled: true; result: SettledResult } | { settled: false; value: T };

/**
 * Marks a run made on a delegating caller's behalf, in which a command that the registry does not define, and a
 * `--log` with nothing to show, exit 0 rather than failing.
 */
export const RUN_IF_PRESENT_ENV_VAR = 'NMR_RUN_IF_PRESENT';

/** @internal */
export interface RunCliResult {
  exitCode: number;
}

/** What an invocation would run, fully determined: the chain, the key under which it records, and how it runs. */
export interface RunPlan {
  commandString: string;
  invocation: Invocation;
  key: string | undefined;
  overrideNotice: string | undefined;
  ownSteps: readonly Step[];
  runId: string;
  runOptions: RunStepsOptions;
  shouldBypassCache: boolean;
  snapshot: TreeSnapshot | undefined;
  steps: readonly Step[];
}

/** An invocation's exit code, and whether it failed because its command is not defined in any scope that it reaches. */
export type SettledResult = RunCliResult & { isUnknownCommand?: boolean };

export const VERSION = resolveSelfVersion(import.meta.url);
