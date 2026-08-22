import { spawnSync } from 'node:child_process';
import process from 'node:process';
import type { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

/**
 * taze's declared CLI export, which is the module taze's own `bin/taze.mjs` imports. Resolving it
 * lazily (rather than importing `taze` at module scope) keeps a missing taze from surfacing as an
 * `ERR_MODULE_NOT_FOUND` in the bin shim, whose handler would misreport it as unbuilt nmr output.
 */
const TAZE_CLI_SPECIFIER = 'taze/cli';

/** The flag taze's CLI reads the request timeout from, as nmr spells it when forwarding one. */
const REQUEST_TIMEOUT_FLAG = '--request-timeout';

/** Every spelling taze's CLI accepts for that flag, each also valid in its `--flag=value` form. */
const REQUEST_TIMEOUT_FLAGS = [REQUEST_TIMEOUT_FLAG, '--requestTimeout'];

/**
 * The request timeout nmr gives taze, in milliseconds.
 *
 * taze's own 5 s ceiling is too short for a registry that proxies npm: it fetches a full packument whenever the
 * resolved registry is not `registry.npmjs.org`, and a large one takes longer than that. The budget covers the
 * whole retry chain, not one attempt, because taze races the chain as a unit against this deadline.
 */
const REQUEST_TIMEOUT_MS = 30_000;

/** Ends the arguments taze reads: everything past it is collected for a downstream tool. */
const ARGUMENT_TERMINATOR = '--';

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
 * Runs taze from nmr's own dependency tree, forwarding `args`, and returns its exit code.
 *
 * Consumers depend on nmr, not on taze, so taze is transitive and its bin is absent from the consumer's
 * root `node_modules/.bin`. This launcher is what bridges that gap: pnpm links nmr's own bins into the
 * consumer root, and nmr resolves taze from the tree it does control.
 *
 * A request timeout is the one argument added, and only where `args` carries none. It belongs here because
 * both other sites are closed to it: a repo overriding the `upgrade` script would leave two of the flag, which
 * taze's parser collects into an array and reads as a near-zero deadline, and a `taze.config.ts` setting lands
 * in the object taze's own CLI defaults overwrite. Every other argument is forwarded untouched, so invocation
 * policy (`--recursive`) stays in the script registry, visible in `nmr` help output and overridable per repo,
 * and upgrade policy stays in `taze.ts`.
 */
export function runTaze(args: string[], options: RunTazeOptions = {}): number {
  const stderr = options.stderr ?? process.stderr;
  const resolveCliPath = options.resolveCliPath ?? resolveTazeCliPath;
  const spawn = options.spawn ?? spawnNode;

  let cliPath: string;
  try {
    cliPath = resolveCliPath();
  } catch (error: unknown) {
    const detail = describeError(error);
    reportError(
      `Could not resolve '${TAZE_CLI_SPECIFIER}' from nmr's dependencies. Reinstall the workspace to restore it. (${detail})`,
      stderr,
    );
    return 1;
  }

  const outcome = spawn(process.execPath, [cliPath, ...composeRequestTimeoutArgs(args), ...args]);

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

// region | Helpers

/** Returns the request-timeout argument to prepend, or nothing where the invocation sets one of its own. */
function composeRequestTimeoutArgs(args: readonly string[]): string[] {
  return carriesRequestTimeout(args) ? [] : [REQUEST_TIMEOUT_FLAG, String(REQUEST_TIMEOUT_MS)];
}

/** Reports whether the invocation sets a request timeout, in any spelling taze's CLI reads it from. */
function carriesRequestTimeout(args: readonly string[]): boolean {
  for (const arg of args) {
    if (arg === ARGUMENT_TERMINATOR) return false;
    if (REQUEST_TIMEOUT_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`))) return true;
  }
  return false;
}

/**
 * Runs a Node script as a child process. stdio is inherited so taze's progress rendering, cursor
 * restore, and `--interactive` mode all see the caller's TTY.
 */
function spawnNode(nodePath: string, argv: string[]): SpawnOutcome {
  const result = spawnSync(nodePath, argv, { stdio: 'inherit' });
  return { status: result.status, error: result.error };
}

// endregion | Helpers
