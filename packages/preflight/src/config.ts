import { existsSync } from 'node:fs';
import path from 'node:path';

import type { PreflightCheckList, PreflightConfig, StagedPreflightCheckList } from './types.ts';

/** The default config file path, resolved relative to `process.cwd()`. */
export const CONFIG_FILE_PATH = '.config/preflight.config.ts';

/** Type-safe identity function for defining a preflight config in a config file. */
export function definePreflightConfig(config: PreflightConfig): PreflightConfig {
  return config;
}

/** Type-safe identity function for defining a flat checklist. */
export function definePreflightCheckList(checklist: PreflightCheckList): PreflightCheckList {
  return checklist;
}

/** Type-safe identity function for defining a staged checklist. */
export function defineStagedPreflightCheckList(checklist: StagedPreflightCheckList): StagedPreflightCheckList {
  return checklist;
}

/** Check whether a value is a plain object (non-null, non-array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate that a raw value conforms to the PreflightConfig shape.
 *
 * Throws on invalid input. When it returns without throwing, the value is a valid PreflightConfig.
 * Because jiti loads the actual TypeScript module, the config objects retain their original types
 * including function-valued properties like `check`.
 */
function assertIsPreflightConfig(raw: unknown): asserts raw is PreflightConfig {
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

/**
 * Load and validate a preflight config file.
 *
 * Searches `.config/preflight.config.ts` by default, or a custom path if provided.
 * Uses jiti to load TypeScript config files at runtime.
 */
export async function loadPreflightConfig(configPath?: string): Promise<PreflightConfig> {
  const resolvedPath = path.resolve(process.cwd(), configPath ?? CONFIG_FILE_PATH);

  if (!existsSync(resolvedPath)) {
    throw new Error(`Preflight config not found: ${resolvedPath}`);
  }

  const { createJiti } = await import('jiti');
  const jiti = createJiti(import.meta.url);
  const imported: unknown = await jiti.import(resolvedPath);

  if (!isRecord(imported)) {
    throw new Error(`Config file must export an object, got ${Array.isArray(imported) ? 'array' : typeof imported}`);
  }

  const resolved = imported.default ?? imported.config;
  if (resolved === undefined) {
    throw new Error(
      'Config file must have a default export or a named `config` export (e.g., `export default definePreflightConfig({ ... })`)',
    );
  }

  assertIsPreflightConfig(resolved);
  return resolved;
}
