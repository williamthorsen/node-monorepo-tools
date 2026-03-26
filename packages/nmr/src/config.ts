import { existsSync } from 'node:fs';
import path from 'node:path';

import { createJiti } from 'jiti';

import { isObject } from './helpers/type-guards.js';

export interface NmrConfig {
  workspaceScripts?: Record<string, string | string[]>;
  rootScripts?: Record<string, string | string[]>;
}

const CONFIG_FILENAME = 'nmr.config.ts';
const CONFIG_DIR = '.config';

/**
 * Type-safe identity function for configuration files.
 *
 * Usage in `.config/nmr.config.ts`:
 * ```ts
 * import { defineConfig } from '@williamthorsen/nmr';
 * export default defineConfig({ ... });
 * ```
 */
export function defineConfig(config: NmrConfig): NmrConfig {
  return config;
}

/**
 * Validates that a loaded value conforms to the expected NmrConfig shape.
 */
function isScriptRecord(value: unknown): value is Record<string, string | string[]> {
  if (!isObject(value)) return false;
  for (const v of Object.values(value)) {
    if (typeof v !== 'string' && !Array.isArray(v)) return false;
    if (Array.isArray(v) && v.some((item) => typeof item !== 'string')) return false;
  }
  return true;
}

/**
 * Validates that a loaded value conforms to the expected NmrConfig shape.
 */
function validateConfig(value: unknown, configPath: string): NmrConfig {
  if (!isObject(value)) {
    throw new Error(`Invalid nmr config at ${configPath}: expected an object, got ${typeof value}`);
  }

  const config: NmrConfig = {};

  if ('workspaceScripts' in value && value.workspaceScripts !== undefined) {
    if (!isScriptRecord(value.workspaceScripts)) {
      throw new Error(
        `Invalid nmr config at ${configPath}: \`workspaceScripts\` must be a Record<string, string | string[]>`,
      );
    }
    config.workspaceScripts = value.workspaceScripts;
  }

  if ('rootScripts' in value && value.rootScripts !== undefined) {
    if (!isScriptRecord(value.rootScripts)) {
      throw new Error(
        `Invalid nmr config at ${configPath}: \`rootScripts\` must be a Record<string, string | string[]>`,
      );
    }
    config.rootScripts = value.rootScripts;
  }

  return config;
}

/**
 * Loads the nmr configuration from `.config/nmr.config.ts` in the monorepo root.
 * Returns an empty config if the file doesn't exist.
 */
export async function loadConfig(monorepoRoot: string): Promise<NmrConfig> {
  const configPath = path.join(monorepoRoot, CONFIG_DIR, CONFIG_FILENAME);

  if (!existsSync(configPath)) {
    return {};
  }

  const jiti = createJiti(path.join(monorepoRoot, 'package.json'));
  const loaded: unknown = await jiti.import(configPath, { default: true });

  return validateConfig(loaded, configPath);
}
