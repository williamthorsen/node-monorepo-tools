/** Check whether a value is a plain object (non-null, non-array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extract `checklists`, `fixLocation`, and `suites` from an imported module namespace.
 *
 * Supports both `export default definePreflightCollection({...})` and the named-export
 * convention (`export const checklists = ...`). Returns a plain record suitable for passing
 * to `assertIsPreflightCollection`.
 */
export function resolveCollectionExports(moduleRecord: Record<string, unknown>): Record<string, unknown> {
  // Unwrap default export when present (e.g., `export default definePreflightCollection({...})`)
  const source = isRecord(moduleRecord.default) ? moduleRecord.default : moduleRecord;

  if (source.checklists === undefined) {
    throw new Error(
      'Collection file must export checklists (e.g., `export default definePreflightCollection({ checklists: [...] })` or `export const checklists = [...]`)',
    );
  }

  return {
    checklists: source.checklists,
    ...(source.fixLocation !== undefined && { fixLocation: source.fixLocation }),
    ...(source.suites !== undefined && { suites: source.suites }),
  };
}
