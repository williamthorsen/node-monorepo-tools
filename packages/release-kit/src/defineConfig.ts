// This module is the `@williamthorsen/release-kit/config` entry, so it must stay loadable standalone: It must not
// import a value, and its type-only imports and re-exports must use the erasable `import type` / `export type … from`
// forms. Because tsc elides the specifier of an inline `import { type … }` and Node's type stripping keeps it, such a
// form would build clean and still pull `types.ts` -- and with it zod -- into a config load.
// `__tests__/defineConfig.tool.test.ts` enforces the invariant.
import type { ReleaseKitConfig } from './types.ts';

export type { LabelSpec, ReleaseKitConfig, RepoLabelsConfig } from './types.ts';

/**
 * Returns a configuration unchanged, typing it as a `ReleaseKitConfig`.
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
