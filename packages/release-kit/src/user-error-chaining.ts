import { isAnticipatedFailure, UserError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

/**
 * Returns `error` as a `UserError` with the same message, for a failure that the tool anticipates, such as a failed
 * external command.
 */
export function asUserError(error: unknown): UserError {
  return error instanceof UserError ? error : new UserError(describeError(error), { cause: error });
}

/** Wraps an anticipated failure as a `UserError` that reads `<message>: <cause's message>`. */
export function chainUserError(message: string, cause: unknown): UserError {
  return new UserError(`${message}: ${describeError(cause)}`, { cause });
}

/**
 * Prefixes an anticipated failure (see `isAnticipatedFailure`) with `<message>: ` as a `UserError`, and returns any
 * other value unchanged, so that a crash keeps its own stack when rethrown.
 */
export function prefixUserError(message: string, error: unknown): unknown {
  return isAnticipatedFailure(error) ? chainUserError(message, error) : error;
}
