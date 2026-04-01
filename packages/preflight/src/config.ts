import { existsSync } from 'node:fs';
import path from 'node:path';

import { assertIsPreflightConfig, isRecord } from './assertIsPreflightConfig.ts';
import { resolveConfigExports } from './resolveConfigExports.ts';
import type { PreflightCheckList, PreflightConfig, StagedPreflightCheckList } from './types.ts';

/** The default config file path, resolved relative to `process.cwd()`. */
export const CONFIG_FILE_PATH = '.config/preflight.config.ts';

/** Type-safe identity function for defining a preflight config in a config file. */
export function definePreflightConfig(config: PreflightConfig): PreflightConfig {
  return config;
}

/** Type-safe identity function for defining an array of checklists in a config file. */
export function defineChecklists(
  checklists: Array<PreflightCheckList | StagedPreflightCheckList>,
): Array<PreflightCheckList | StagedPreflightCheckList> {
  return checklists;
}

/** Type-safe identity function for defining a flat checklist. */
export function definePreflightCheckList(checklist: PreflightCheckList): PreflightCheckList {
  return checklist;
}

/** Type-safe identity function for defining a staged checklist. */
export function defineStagedPreflightCheckList(checklist: StagedPreflightCheckList): StagedPreflightCheckList {
  return checklist;
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

  const resolved = resolveConfigExports(imported);
  assertIsPreflightConfig(resolved);
  return resolved;
}
