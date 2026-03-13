import { execSync } from 'node:child_process';
import process from 'node:process';

export interface RunCommandOptions {
  /** When true, suppress output on success and write captured output to stderr on failure. */
  quiet?: boolean;
}

/**
 * Executes a command synchronously.
 * Returns the exit code of the command.
 *
 * In quiet mode, output is captured (piped) instead of inherited.
 * On success, captured output is discarded. On failure, it is written to stderr.
 */
export function runCommand(command: string, cwd?: string, options?: RunCommandOptions): number {
  const quiet = options?.quiet === true;
  const stdio = quiet ? 'pipe' : 'inherit';

  try {
    execSync(command, { stdio, cwd });
    return 0;
  } catch (error) {
    // execSync throws on non-zero exit code.
    // The error object has a `status` property with the exit code.
    if (error !== null && typeof error === 'object') {
      if (quiet) {
        writeErrorOutput(error);
      }
      if ('status' in error) {
        const { status } = error;
        return typeof status === 'number' ? status : 1;
      }
    }
    return 1;
  }
}

/** Writes captured stdout and stderr buffers from an execSync error to `process.stderr`. */
function writeErrorOutput(error: object): void {
  if ('stdout' in error) {
    const { stdout } = error;
    if (Buffer.isBuffer(stdout) && stdout.length > 0) {
      process.stderr.write(stdout);
    }
  }
  if ('stderr' in error) {
    const { stderr } = error;
    if (Buffer.isBuffer(stderr) && stderr.length > 0) {
      process.stderr.write(stderr);
    }
  }
}
