import { InvalidBuildInfoError } from './InvalidBuildInfoError.ts';
import { normalizeBuildInfo } from './normalize.ts';
import type { BuildInfo } from './types.ts';

/**
 * Reports whether the value is an object that satisfies the `BuildInfo` contract. A string is never one, even a JSON
 * string that `parseBuildInfo` would accept. Unknown keys do not disqualify a value.
 */
export function isBuildInfo(value: unknown): value is BuildInfo {
  if (typeof value === 'string') {
    return false;
  }
  try {
    normalizeBuildInfo(value);
    return true;
  } catch (error: unknown) {
    if (error instanceof InvalidBuildInfoError) {
      return false;
    }
    throw error;
  }
}

/**
 * Parses a JSON string or an already-parsed value into a `BuildInfo`, dropping unknown keys at every level so that a
 * file written by a newer collector still parses.
 *
 * @throws {InvalidBuildInfoError} naming the first field that breaks the contract, or with an empty `path` when the
 * string is not JSON.
 */
export function parseBuildInfo(value: unknown): BuildInfo {
  return normalizeBuildInfo(typeof value === 'string' ? parseJson(value) : value);
}

// region | Helpers

/** Parses JSON text, wrapping a syntax error in an `InvalidBuildInfoError` with an empty path. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error: unknown) {
    throw new InvalidBuildInfoError('', 'expected a JSON string', { cause: error });
  }
}

// endregion | Helpers
