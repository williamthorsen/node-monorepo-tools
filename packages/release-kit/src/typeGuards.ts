/** Narrows an `unknown` value to `unknown[]` via `Array.isArray`, avoiding `any[]`. */
export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
