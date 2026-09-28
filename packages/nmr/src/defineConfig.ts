// This module is the `@williamthorsen/nmr/config` entry, so it must stay loadable standalone, without a value
// import and with type-only imports and re-exports written in the erasable `import type` / `export type … from`
// forms. Because Node's type stripping keeps the specifier of an inline `import { type … }`, which tsc elides,
// such a form would build clean and still make a config load import `types.ts`.
// `__tests__/defineConfig.tool.test.ts` enforces the invariant.
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
 * Returns `config` unchanged, typing a configuration file's default export as `NmrConfig`.
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
