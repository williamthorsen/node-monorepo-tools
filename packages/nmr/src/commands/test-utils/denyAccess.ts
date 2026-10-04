import { chmodSync } from 'node:fs';
import process from 'node:process';

/** Whether this process bypasses permission checks, which leaves `denyAccess` without effect. */
export const isPrivilegedProcess = process.getuid?.() === 0;

/**
 * Removes every permission from `directory`, so that a stat of any path beneath it fails with `EACCES`, and
 * restores them on disposal so that the temp tree containing it can be removed.
 */
export function denyAccess(directory: string): Disposable {
  chmodSync(directory, 0o000);
  return {
    [Symbol.dispose]: () => {
      chmodSync(directory, 0o755);
    },
  };
}
