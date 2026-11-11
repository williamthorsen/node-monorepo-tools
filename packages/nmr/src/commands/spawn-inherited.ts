import { spawnSync } from 'node:child_process';

import { describeSignalExitCode } from '../child-process.ts';

/** How a program spawned on the caller's stdio ended. */
export interface InheritedOutcome {
  error?: Error | undefined;
  signal: NodeJS.Signals | null;
  status: number | null;
}

export interface SpawnInheritedOptions {
  /** Directory in which the program runs. Defaults to the current one. */
  cwd?: string;
  /** Environment for the program. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/** A function that runs a program on the caller's stdio, the shape of each command's injectable spawn. */
export type SpawnInherited = typeof spawnInherited;

/** Returns the exit code that reports how the program ended: the shell's code for a death by signal, else its status. */
export function resolveInheritedExitCode({ signal, status }: Pick<InheritedOutcome, 'signal' | 'status'>): number {
  if (signal !== null) return describeSignalExitCode(signal);
  return status ?? 1;
}

/**
 * Runs a program on the caller's stdio, so that it sees the caller's terminal: It colors its output, renders
 * progress, and reads input as it would when run directly.
 */
export function spawnInherited(
  file: string,
  args: readonly string[],
  options: SpawnInheritedOptions = {},
): InheritedOutcome {
  const result = spawnSync(file, args, { cwd: options.cwd, env: options.env, stdio: 'inherit' });
  return { error: result.error, signal: result.signal, status: result.status };
}
