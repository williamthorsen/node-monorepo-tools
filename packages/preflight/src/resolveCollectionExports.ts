/**
 * Extract `checklists` and `fixLocation` from an imported module namespace.
 *
 * Requires the named-export convention (`export const checklists = ...`). Returns a plain
 * record suitable for passing to `assertIsPreflightCollection`.
 */
export function resolveCollectionExports(moduleRecord: Record<string, unknown>): Record<string, unknown> {
  if (moduleRecord.checklists === undefined) {
    throw new Error(
      'Collection file must export a named `checklists` export (e.g., `export const checklists = defineChecklists([...])`)',
    );
  }

  const resolved: Record<string, unknown> = { checklists: moduleRecord.checklists };
  if (moduleRecord.fixLocation !== undefined) {
    resolved.fixLocation = moduleRecord.fixLocation;
  }

  return resolved;
}
