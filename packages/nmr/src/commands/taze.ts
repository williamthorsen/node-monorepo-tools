import { spawnSync } from 'node:child_process';
import process from 'node:process';
import type { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { reportError } from '@williamthorsen/nmr-core';

/**
 * taze's declared CLI export, which is the module taze's own `bin/taze.mjs` imports. Resolving it
 * lazily (rather than importing `taze` at module scope) keeps a missing taze from surfacing as an
 * `ERR_MODULE_NOT_FOUND` in the bin shim, whose handler would misreport it as unbuilt nmr output.
 */
const TAZE_CLI_SPECIFIER = 'taze/cli';

export interface SpawnOutcome {
  status: number | null;
  error?: Error | undefined;
}

export interface RunTazeOptions {
  /** Resolves the absolute path of taze's CLI entry. Injected by tests. */
  resolveCliPath?: () => string;
  /** Runs the CLI and reports how it exited. Injected by tests. */
  spawn?: (nodePath: string, argv: string[]) => SpawnOutcome;
  /** Stream that error output is written to. Defaults to `process.stderr`. */
  stderr?: Writable;
}

/**
 * Runs taze from nmr's own dependency tree, forwarding `args` verbatim, and returns its exit code.
 *
 * Consumers depend on nmr, not on taze, so taze is transitive and its bin is absent from the consumer's
 * root `node_modules/.bin`. This launcher is what bridges that gap: pnpm links nmr's own bins into the
 * consumer root, and nmr resolves taze from the tree it does control.
 *
 * No argument is interpreted or added here. Invocation policy (`--include-locked`, `--recursive`) lives in
 * the script registry, where it stays visible in `nmr` help output and overridable per repo.
 */
export function runTaze(args: string[], options: RunTazeOptions = {}): number {
  const stderr = options.stderr ?? process.stderr;
  const resolveCliPath = options.resolveCliPath ?? resolveTazeCliPath;
  const spawn = options.spawn ?? spawnNode;

  let cliPath: string;
  try {
    cliPath = resolveCliPath();
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    reportError(
      `Could not resolve '${TAZE_CLI_SPECIFIER}' from nmr's dependencies. Reinstall the workspace to restore it. (${detail})`,
      stderr,
    );
    return 1;
  }

  const outcome = spawn(process.execPath, [cliPath, ...args]);

  // A spawn failure yields no exit status to propagate, so it is reported rather than collapsed into a bare 1.
  if (outcome.error) {
    reportError(`Failed to run taze: ${outcome.error.message}`, stderr);
    return 1;
  }

  return outcome.status ?? 1;
}

/** Resolves the absolute path of taze's CLI entry from nmr's own dependency tree. */
export function resolveTazeCliPath(): string {
  return fileURLToPath(import.meta.resolve(TAZE_CLI_SPECIFIER));
}

/**
 * Runs a Node script as a child process. stdio is inherited so taze's progress rendering, cursor
 * restore, and `--interactive` mode all see the caller's TTY.
 */
function spawnNode(nodePath: string, argv: string[]): SpawnOutcome {
  const result = spawnSync(nodePath, argv, { stdio: 'inherit' });
  return { status: result.status, error: result.error };
}
