// This module is the `@williamthorsen/release-kit/config` entry, so it must stay loadable standalone: no value
// import, and type-only imports and re-exports written in the erasable `import type` / `export type … from` forms.
// Node's type stripping keeps the specifier of an inline `import { type … }`, which tsc elides, so such a form would
// build clean and still pull `types.ts` -- and with it zod -- into a config load. `__tests__/defineConfig.tool.test.ts`
// enforces the invariant.
import type { ReleaseKitConfig } from './types.ts';

export type { LabelSpec, ReleaseKitConfig, RepoLabelsConfig } from './types.ts';

/**
 * Type-safe identity function for configuration files.
 *
 * Usage in `.config/release-kit.config.ts`:
 * ```ts
 * import { defineConfig } from '@williamthorsen/release-kit/config';
 * export default defineConfig({ ... });
 * ```
 */
export function defineConfig(config: ReleaseKitConfig): ReleaseKitConfig {
  return config;
}
