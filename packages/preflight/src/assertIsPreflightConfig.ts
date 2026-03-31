import type { PreflightConfig } from './types.ts';

/** Check whether a value is a plain object (non-null, non-array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate that a raw value conforms to the PreflightConfig shape.
 *
 * Throws on invalid input. When it returns without throwing, the value is a valid PreflightConfig.
 * Because jiti loads the actual TypeScript module, the config objects retain their original types
 * including function-valued properties like `check`.
 */
export function assertIsPreflightConfig(raw: unknown): asserts raw is PreflightConfig {
  if (!isRecord(raw)) {
    throw new TypeError(`Preflight config must be an object, got ${Array.isArray(raw) ? 'array' : typeof raw}`);
  }

  if (!Array.isArray(raw.checklists)) {
    throw new TypeError("Preflight config must have a 'checklists' array");
  }

  for (const [i, entry] of raw.checklists.entries()) {
    if (!isRecord(entry)) {
      throw new Error(`checklists[${i}]: must be an object`);
    }
    if (typeof entry.name !== 'string' || entry.name === '') {
      throw new Error(`checklists[${i}]: 'name' is required and must be a non-empty string`);
    }
    const hasChecks = 'checks' in entry;
    const hasGroups = 'groups' in entry;
    if (!hasChecks && !hasGroups) {
      throw new Error(`checklists[${i}]: must have either 'checks' or 'groups'`);
    }
    if (hasChecks && hasGroups) {
      throw new Error(`checklists[${i}]: cannot have both 'checks' and 'groups'`);
    }
  }
}
