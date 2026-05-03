/**
 * Shared helpers for the work-types canonical-source tooling.
 *
 * Both `checkWorkTypesDrift` and `syncWorkTypes` need to validate the upstream JSON's top-level
 * shape and render unknown errors as strings. Keeping a single copy here avoids byte-for-byte
 * duplication between the two entry points.
 */

/** Sanity-check that the parsed upstream JSON carries the expected top-level shape. */
export function hasExpectedTopLevelShape(value: unknown): value is { tiers: unknown[]; types: unknown[] } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!('tiers' in value) || !('types' in value)) {
    return false;
  }
  return Array.isArray(value.tiers) && Array.isArray(value.types);
}

/** Render an unknown error value as a string for diagnostics. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
