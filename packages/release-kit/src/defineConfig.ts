import type { ReleaseKitConfig } from './types.ts';

/**
 * Type-safe identity function for configuration files.
 *
 * Usage in `.config/release-kit.config.ts`:
 * ```ts
 * import { defineConfig } from '@williamthorsen/release-kit';
 * export default defineConfig({ ... });
 * ```
 */
export function defineConfig(config: ReleaseKitConfig): ReleaseKitConfig {
  return config;
}
