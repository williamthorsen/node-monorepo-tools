import { execSync } from 'node:child_process';

/**
 * Executes a command synchronously with inherited stdio.
 * Returns the exit code of the command.
 */
export function runCommand(command: string, cwd?: string): number {
  try {
    execSync(command, {
      stdio: 'inherit',
      cwd,
    });
    return 0;
  } catch (error) {
    // execSync throws on non-zero exit code.
    // The error object has a `status` property with the exit code.
    if (error !== null && typeof error === 'object' && 'status' in error) {
      const { status } = error;
      return typeof status === 'number' ? status : 1;
    }
    return 1;
  }
}
