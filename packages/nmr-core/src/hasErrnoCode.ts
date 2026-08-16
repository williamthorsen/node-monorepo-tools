import { isError } from '@williamthorsen/toolbelt.errors';

/**
 * Reports whether a thrown value is an `Error` carrying the given Node errno code.
 *
 * Node attaches the code to the error rather than to a wrapper, so a `catch` binding is the only place it can be
 * read, and reading it means narrowing an `unknown` first. `isError` does that narrowing, recognizing an `Error`
 * crossing a realm boundary, which a bare `instanceof` test reports as false.
 */
export function hasErrnoCode(error: unknown, code: string): boolean {
  return isError(error) && 'code' in error && error.code === code;
}
