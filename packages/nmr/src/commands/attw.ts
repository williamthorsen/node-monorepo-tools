import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Writable } from 'node:stream';

import { hasPublishableEntryPoint, readPackageJson } from '../helpers/package-json.ts';

const DEFAULT_PROFILE = 'esm-only';

/**
 * The `spawnSync` surface the wrapper depends on, narrowed to a single signature
 * so a test can inject a stub in place of the real `npm`/`attw` subprocesses.
 */
export type SpawnSyncFn = (
  command: string,
  args: string[],
  options: { cwd: string; encoding: 'utf8'; env: NodeJS.ProcessEnv },
) => Pick<SpawnSyncReturns<string>, 'error' | 'status' | 'stdout' | 'stderr'>;

/** @internal */
export interface RunAttwOptions {
  /** Directory of the workspace package to check. */
  packageDir: string;
  /** Post-command CLI args, forwarded to attw. `--verbose`/`-v` is consumed here. */
  argv: string[];
  /** Stream for normal output (skip notice, terse confirmation, attw diagnostics). */
  stdout: Writable;
  /** Stream for error output (pack failures, missing-binary hint). */
  stderr: Writable;
  /** Environment for the `npm pack` and `attw` subprocesses. */
  env: NodeJS.ProcessEnv;
  /** Subprocess runner, defaulting to `spawnSync`; injected in tests. */
  spawn?: SpawnSyncFn;
}

/**
 * Runs `attw` against a workspace package's packed contents, but only when the
 * package declares a publishable entry point. Packs into an isolated temp dir so
 * no `.tgz` ever lands in the working tree, and condenses attw's output to a terse
 * per-package result on success, full diagnostics on failure.
 *
 * Returns the exit code: 0 for a skipped or passing package, attw's own code on a
 * finding, and 1 for a pack failure or a missing attw binary.
 */
export function runAttw(options: RunAttwOptions): number {
  const { packageDir, argv, stdout, stderr, env } = options;
  const spawn: SpawnSyncFn = options.spawn ?? ((command, args, spawnOptions) => spawnSync(command, args, spawnOptions));

  const pkg = readPackageJson(packageDir);
  const label = pkg.name ?? path.basename(packageDir);

  if (!hasPublishableEntryPoint(pkg)) {
    stdout.write(`⛔ ${label}: No publishable entry point (no "main"/"exports"). Skipping attw.\n`);
    return 0;
  }

  const { verbose, attwArgs } = buildAttwArgs(argv);

  // Pack into a throwaway temp dir rather than letting `attw --pack` write the
  // tarball into the package dir, whose only cleanup is on attw's happy path.
  const tempDir = mkdtempSync(path.join(tmpdir(), 'nmr-attw-'));
  try {
    const pack = spawn('npm', ['pack', '--pack-destination', tempDir], { cwd: packageDir, encoding: 'utf8', env });
    if (pack.error !== undefined) {
      stderr.write(`nmr-attw: npm pack failed for ${label}: ${pack.error.message}\n`);
      return 1;
    }
    if (pack.status !== 0) {
      stderr.write(pack.stderr || `nmr-attw: npm pack failed for ${label}\n`);
      return pack.status ?? 1;
    }

    const tarball = readdirSync(tempDir).find((file) => file.endsWith('.tgz'));
    if (tarball === undefined) {
      stderr.write(`nmr-attw: npm pack produced no tarball for ${label}\n`);
      return 1;
    }

    const attw = spawn('attw', [path.join(tempDir, tarball), ...attwArgs], {
      cwd: packageDir,
      encoding: 'utf8',
      env,
    });
    if (attw.error !== undefined) {
      stderr.write(attwSpawnErrorMessage(label, attw.error));
      return 1;
    }

    const outcome = formatAttwResult({
      label,
      verbose,
      attwStatus: attw.status,
      attwStdout: attw.stdout,
      attwStderr: attw.stderr,
    });
    if (outcome.stdout) stdout.write(outcome.stdout);
    if (outcome.stderr) stderr.write(outcome.stderr);
    return outcome.status;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Splits post-command args into the wrapper's own `--verbose`/`-v` flag and the
 * args forwarded to attw, appending the default `--profile` when the caller
 * supplied none.
 */
export function buildAttwArgs(argv: string[]): { verbose: boolean; attwArgs: string[] } {
  let verbose = false;
  const attwArgs: string[] = [];
  for (const arg of argv) {
    if (arg === '--verbose' || arg === '-v') {
      verbose = true;
      continue;
    }
    attwArgs.push(arg);
  }
  if (!attwArgs.some((arg) => arg === '--profile' || arg.startsWith('--profile='))) {
    attwArgs.push('--profile', DEFAULT_PROFILE);
  }
  return { verbose, attwArgs };
}

interface AttwOutcome {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Decides what the wrapper writes and returns from attw's captured result: full
 * diagnostics on failure, and a terse confirmation on success unless `--verbose`.
 */
export function formatAttwResult(params: {
  label: string;
  verbose: boolean;
  attwStatus: number | null;
  attwStdout: string;
  attwStderr: string;
}): AttwOutcome {
  const { label, verbose, attwStatus, attwStdout, attwStderr } = params;

  const status = attwStatus ?? 1;
  if (status === 0 && !verbose) {
    return { status: 0, stdout: `✓ ${label}: types OK\n`, stderr: '' };
  }
  return { status, stdout: attwStdout, stderr: attwStderr };
}

/**
 * Builds the message for a failed attw spawn: an actionable install hint when the
 * binary is missing (`ENOENT`), otherwise the underlying spawn error. A missing
 * binary means a package that *does* declare an entry point can't be validated —
 * `@arethetypeswrong/cli` isn't installed.
 */
export function attwSpawnErrorMessage(label: string, error: Error): string {
  if ('code' in error && error.code === 'ENOENT') {
    return `⚠ ${label}: attw not found — install @arethetypeswrong/cli to validate published types.\n`;
  }
  return `nmr-attw: failed to run attw for ${label}: ${error.message}\n`;
}
