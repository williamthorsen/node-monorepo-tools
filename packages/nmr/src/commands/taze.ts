import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import type { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { loadPackageMaturityPeriod } from './load-package-maturity-period.ts';
import { isSilent, readFlag } from './taze-args.ts';
import { planTazePasses, type TazePass } from './taze-passes.ts';

/**
 * taze's declared CLI export, which is the module imported by taze's own `bin/taze.mjs`. Resolving it
 * lazily (rather than importing `taze` at module scope) keeps a missing taze from appearing as an
 * `ERR_MODULE_NOT_FOUND` in the bin shim, whose handler would misreport it as unbuilt nmr output.
 */
const TAZE_CLI_SPECIFIER = 'taze/cli';

/** The flag from which taze's CLI reads the request timeout, as nmr spells it when forwarding one. */
const REQUEST_TIMEOUT_FLAG = '--request-timeout';

/** Every spelling that taze's CLI accepts for that flag, each also valid in its `--flag=value` form. */
const REQUEST_TIMEOUT_FLAGS = [REQUEST_TIMEOUT_FLAG, '--requestTimeout'];

/**
 * The request timeout that nmr gives taze, in milliseconds.
 *
 * taze's own 5 s ceiling is too short for a registry that proxies npm: It fetches a full packument whenever the
 * resolved registry is not `registry.npmjs.org`, and a large one takes longer than that. The budget covers the
 * whole retry chain, not one attempt, because taze races the chain as a unit against this deadline.
 */
const REQUEST_TIMEOUT_MS = 30_000;

export interface SpawnOutcome {
  status: number | null;
  error?: Error | undefined;
}

export interface RunTazeOptions {
  /** Returns the `packageMaturityPeriod` that the taze config governing a directory declares. Injected by tests. */
  loadConfig?: (cwd: string) => Promise<unknown>;
  /** Resolves the absolute path of taze's CLI entry. Injected by tests. */
  resolveCliPath?: () => string;
  /** Runs the CLI and reports how it exited. Injected by tests. */
  spawn?: (nodePath: string, argv: string[]) => SpawnOutcome;
  /** Stream that error output and pass headings are written to. Defaults to `process.stderr`. */
  stderr?: Writable;
}

/**
 * Runs taze from nmr's own dependency tree, forwarding `args`, and returns its exit code.
 *
 * When the repo's taze config declares `packageMaturityPeriod`, runs taze once per entry and once for every other
 * dependency, each with `args` and the filters and period that `planTazePasses` adds, and returns the first non-zero
 * exit code among them. Every pass runs; a heading on `stderr` names each pass unless `args` silence taze.
 *
 * Consumers depend on nmr, not on taze, so taze is transitive and its bin is absent from the consumer's
 * root `node_modules/.bin`. This launcher runs taze without that bin: pnpm links nmr's own bins into the
 * consumer root, and nmr resolves taze from the tree that it does control.
 *
 * Every pass also receives a request timeout, unless `args` sets one. Neither other site can declare it: Because
 * an invocation's trailing arguments are appended to the resolved command string, the same flag in the `upgrade`
 * script would be doubled by `nmr upgrade --request-timeout ...`, and taze's parser collects the pair into an
 * array that it reads as a near-zero deadline; a `taze.config.ts` setting goes into the object that taze's own CLI
 * defaults overwrite. Because every argument of the invocation reaches taze, invocation policy (`--recursive`)
 * stays in the script registry, visible in `nmr` help output and overridable per repo, and upgrade policy stays in
 * `taze.ts`.
 */
export async function runTaze(args: string[], options: RunTazeOptions = {}): Promise<number> {
  const stderr = options.stderr ?? process.stderr;
  const resolveCliPath = options.resolveCliPath ?? resolveTazeCliPath;
  const spawn = options.spawn ?? spawnNode;
  const loadConfig = options.loadConfig ?? loadPackageMaturityPeriod;

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

  let passes: TazePass[];
  try {
    passes = planTazePasses(args, await loadConfig(resolveConfigDir(args)));
  } catch (error: unknown) {
    reportError(`Could not read the taze config: ${describeError(error)}`, stderr);
    return 1;
  }

  const showHeadings = !isSilent(args);
  let exitCode = 0;
  for (const pass of passes) {
    if (pass.heading !== undefined && showHeadings) stderr.write(`${pass.heading}\n`);
    const outcome = spawn(process.execPath, [cliPath, ...composeRequestTimeoutArgs(pass.args), ...pass.args]);

    // Report a spawn failure rather than collapse it into a bare 1, because it does not yield any exit
    // status to propagate.
    if (outcome.error) {
      reportError(`Failed to run taze: ${outcome.error.message}`, stderr);
      return 1;
    }

    const status = outcome.status ?? 1;
    if (exitCode === 0) exitCode = status;
  }

  return exitCode;
}

/** Resolves the absolute path of taze's CLI entry from nmr's own dependency tree. */
export function resolveTazeCliPath(): string {
  return fileURLToPath(import.meta.resolve(TAZE_CLI_SPECIFIER));
}

// region | Helpers

/** Returns the request-timeout argument to prepend, or nothing when the invocation sets one of its own. */
function composeRequestTimeoutArgs(args: readonly string[]): string[] {
  return readFlag(args, REQUEST_TIMEOUT_FLAGS) === undefined ? [REQUEST_TIMEOUT_FLAG, String(REQUEST_TIMEOUT_MS)] : [];
}

/** Returns the directory from which taze resolves its config: the invocation's `--cwd`, else the current one. */
function resolveConfigDir(args: readonly string[]): string {
  return path.resolve(readFlag(args, ['--cwd', '-C'])?.value ?? '.');
}

/**
 * Runs a Node script as a child process. stdio is inherited so that taze's progress rendering, cursor
 * restore, and `--interactive` mode all see the caller's TTY.
 */
function spawnNode(nodePath: string, argv: string[]): SpawnOutcome {
  const result = spawnSync(nodePath, argv, { stdio: 'inherit' });
  return { status: result.status, error: result.error };
}

// endregion | Helpers
