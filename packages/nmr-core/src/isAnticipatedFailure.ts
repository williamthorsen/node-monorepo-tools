import { isError } from '@williamthorsen/toolbelt.errors';

import { UserError } from './UserError.ts';

/**
 * Reports whether a thrown value is a failure that a CLI reports as `Error: <message>` rather than as an internal
 * error: a `UserError`, or a Node system error such as `EACCES` or `ENOENT`, which comes from the environment.
 */
export function isAnticipatedFailure(error: unknown): error is Error {
  return error instanceof UserError || isSystemError(error);
}

// region | Helpers

/** Narrows a thrown value to an `Error` from a failed system call: one with a `code` and a `syscall`. */
function isSystemError(error: unknown): error is Error & { code: string; syscall: string } {
  return (
    isError(error) &&
    'code' in error &&
    typeof error.code === 'string' &&
    'syscall' in error &&
    typeof error.syscall === 'string'
  );
}

// endregion | Helpers
