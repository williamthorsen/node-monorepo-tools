// This module is the `@williamthorsen/nmr/config` entry, so it must stay loadable standalone: no value import, and
// type-only imports and re-exports written in the erasable `import type` / `export type … from` forms. Node's type
// stripping keeps the specifier of an inline `import { type … }`, which tsc elides, so such a form would build clean
// and still pull `types.ts` into a config load. `__tests__/defineConfig.tool.test.ts` enforces the invariant.
import type { NmrConfig } from './types.ts';

export type {
  BuildConfig,
  CheckCacheConfig,
  CommandVerbosity,
  NmrConfig,
  OutputConfig,
  ScriptValue,
  StepSpec,
} from './types.ts';

/**
 * Type-safe identity function for configuration files.
 *
 * Usage in `.config/nmr.config.ts`:
 * ```ts
 * import { defineConfig } from '@williamthorsen/nmr/config';
 * export default defineConfig({ ... });
 * ```
 */
export function defineConfig(config: NmrConfig): NmrConfig {
  return config;
}
