import { quoteForShell } from '../helpers/quoteForShell.ts';

/**
 * Appends to a failed step's message the resource that the host's filesystem has run out of, when the step's output
 * reports a full filesystem and the counts that `runOnHost` reads say which. A write fails alike for lack of space and
 * of inodes.
 */
export async function appendFilesystemReason(
  message: string,
  output: string,
  runOnHost: (script: string) => Promise<{ exitCode: number; output: string }>,
): Promise<string> {
  if (!FULL_FILESYSTEM_PATTERN.test(output)) return message;

  const check = await runOnHost(composeFilesystemCheckScript());
  const reason = check.exitCode === 0 ? describeExhaustedResource(check.output) : undefined;
  return reason === undefined ? message : `${message}: ${reason}`;
}

/** Composes the shell command that prints, on the host, the free counts of the filesystem that holds its home. */
export function composeFilesystemCheckScript(): string {
  return `node -e ${quoteForShell(`(${readHostFilesystem.toString()})();`)}`;
}

/**
 * Names the resource that the host's filesystem has run out of, from what `composeFilesystemCheckScript` printed, or
 * returns `undefined` when neither count is zero or the output does not include them.
 */
export function describeExhaustedResource(output: string): string | undefined {
  const counts = output
    .split('\n')
    .map(parseCounts)
    .findLast((value) => value !== undefined);
  if (counts?.ffree === 0) return "the host's filesystem has run out of inodes";
  if (counts?.bavail === 0) return "the host's filesystem has run out of space";
  return undefined;
}

/**
 * Runs on the host and prints, as one JSON line, the free inodes and the blocks available to this user on the
 * filesystem that holds the home directory. It is sent as source, so it refers to nothing outside its own body.
 *
 * @internal
 */
export function readHostFilesystem(): void {
  const fs = process.getBuiltinModule('node:fs');
  const os = process.getBuiltinModule('node:os');

  const { bavail, ffree } = fs.statfsSync(os.homedir());
  process.stdout.write(`${JSON.stringify({ bavail, ffree })}\n`);
}

// region | Helpers

/** Matches what a process prints when a write fails because its filesystem is full. */
const FULL_FILESYSTEM_PATTERN = /no space left on device|ENOSPC/i;

/** Parses a line of the check's output, or returns `undefined` for a line that does not contain both counts. */
function parseCounts(line: string): { bavail: number; ffree: number } | undefined {
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== 'object' || value === null || !('bavail' in value) || !('ffree' in value)) return undefined;
    const { bavail, ffree } = value;
    return typeof bavail === 'number' && typeof ffree === 'number' ? { bavail, ffree } : undefined;
  } catch {
    return undefined;
  }
}

// endregion | Helpers
