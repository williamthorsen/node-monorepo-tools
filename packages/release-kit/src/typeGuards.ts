/** Check whether a value is a plain object (non-null, non-array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Narrow an `unknown` value to `unknown[]` via `Array.isArray`, avoiding `any[]`. */
export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
