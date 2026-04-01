import { isRecord } from './assertIsPreflightConfig.ts';

/**
 * Extract `checklists` and `fixLocation` from an imported module namespace.
 *
 * Supports both the named-export convention (`export const checklists = ...`) and the legacy
 * default-export convention (`export default definePreflightConfig(...)`). Returns a plain
 * record suitable for passing to `assertIsPreflightConfig`.
 */
export function resolveConfigExports(moduleRecord: Record<string, unknown>): Record<string, unknown> {
  let checklists: unknown = moduleRecord.checklists;

  // Fall back to default export for backward compatibility with `export default definePreflightConfig(...)`.
  const defaultExport = isRecord(moduleRecord.default) ? moduleRecord.default : undefined;
  if (checklists === undefined && defaultExport !== undefined) {
    checklists = defaultExport.checklists;
  }

  if (checklists === undefined) {
    throw new Error(
      'Config file must export a named `checklists` export (e.g., `export const checklists = defineChecklists([...])`)',
    );
  }

  const fixLocation: unknown = moduleRecord.fixLocation ?? defaultExport?.fixLocation;
  const resolved: Record<string, unknown> = { checklists };
  if (fixLocation !== undefined) {
    resolved.fixLocation = fixLocation;
  }

  return resolved;
}
