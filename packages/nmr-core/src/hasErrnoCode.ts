import { isError } from '@williamthorsen/toolbelt.errors';

/**
 * Narrows a thrown value to an `Error` carrying the given Node errno code.
 *
 * `isError` recognizes an `Error` crossing a realm boundary, which a bare `instanceof` test reports as false.
 */
export function hasErrnoCode(error: unknown, code: string): error is Error & { code: string } {
  return isError(error) && 'code' in error && error.code === code;
}
