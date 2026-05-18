import { spawnSync } from 'node:child_process';
import process from 'node:process';
import type { Writable } from 'node:stream';

export interface RunCommandOptions {
  /** When true, suppress output on success and write captured output to stderr on failure. */
  quiet?: boolean;
  /** Stream that subprocess stdout flows to in non-quiet mode. Defaults to `process.stdout`. */
  stdout?: Writable;
  /** Stream that subprocess stderr flows to (and that quiet-mode failure output is written to). Defaults to `process.stderr`. */
  stderr?: Writable;
  /** Environment for the subprocess. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Executes a command synchronously.
 * Returns the exit code of the command.
 *
 * In quiet mode, output is captured (piped) instead of inherited.
 * On success, captured output is discarded. On failure, it is written to `options.stderr`.
 *
 * In non-quiet mode, each of stdout/stderr is routed by fd inheritance when the
 * caller's stream exposes one (the production path via `process.stdout`/`stderr`)
 * for real-time streaming, otherwise piped and forwarded into the caller's stream
 * after the child exits (the test path via `PassThrough`).
 */
export function runCommand(command: string, cwd?: string, options?: RunCommandOptions): number {
  const quiet = options?.quiet === true;
  const stdout = options?.stdout ?? process.stdout;
  const stderr = options?.stderr ?? process.stderr;
  const env = options?.env ?? process.env;

  const stdoutChannel = quiet ? 'pipe' : streamFdOrPipe(stdout);
  const stderrChannel = quiet ? 'pipe' : streamFdOrPipe(stderr);

  const result = spawnSync(command, [], {
    shell: true,
    stdio: ['inherit', stdoutChannel, stderrChannel],
    cwd,
    env,
  });

  if (result.error) {
    stderr.write(`${result.error.message}\n`);
    return 1;
  }

  if (quiet) {
    if (result.status !== 0) {
      writeBuffer(result.stdout, stderr);
      writeBuffer(result.stderr, stderr);
    }
  } else {
    if (stdoutChannel === 'pipe') writeBuffer(result.stdout, stdout);
    if (stderrChannel === 'pipe') writeBuffer(result.stderr, stderr);
  }

  return result.status ?? 1;
}

/** Returns the stream's numeric file descriptor for fd inheritance, or `'pipe'` if unavailable. */
function streamFdOrPipe(stream: Writable): number | 'pipe' {
  return 'fd' in stream && typeof stream.fd === 'number' ? stream.fd : 'pipe';
}

/** Writes a captured buffer to the destination stream, skipping empty payloads. */
function writeBuffer(buffer: Buffer | string, dest: Writable): void {
  if (buffer.length > 0) dest.write(buffer);
}
