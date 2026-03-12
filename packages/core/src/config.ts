import { existsSync } from 'node:fs';
import path from 'node:path';

import { createJiti } from 'jiti';

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
 * import { defineConfig } from '@williamthorsen/node-monorepo-core';
 * export default defineConfig({ ... });
 * ```
 */
export function defineConfig(config: NmrConfig): NmrConfig {
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
  const loaded: NmrConfig = await jiti.import(configPath, { default: true });

  return loaded;
}
