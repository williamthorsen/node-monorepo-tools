import type { CheckOptions } from 'taze';

/**
 * A taze configuration.
 *
 * Every property admits `undefined` explicitly, unlike `Partial<CheckOptions>`, which rejects it under
 * `exactOptionalPropertyTypes`. Passing `undefined` is how a consumer clears `mode`, so the type has to allow
 * it.
 */
export type TazeConfig = { [K in keyof CheckOptions]?: CheckOptions[K] | undefined } & {
  /**
   * Maturity period in days for each package pattern, read by `nmr-taze` rather than by taze. A key is a package
   * name in which `*` matches any run of characters, and the first key that matches a package decides its period.
   * Every other dependency keeps `maturityPeriod` or, while that is unset, pnpm's `minimumReleaseAge`.
   */
  packageMaturityPeriod?: Record<string, number> | undefined;
};

/**
 * Upgrade policy that nmr applies to every consumer, leaving a repo's own config to contain only what is local to
 * it.
 */
const SHARED_POLICY: TazeConfig = {
  // Report a dependency pinned to a bare version, which a repo using pnpm's `savePrefix: ''` declares for
  // every one of them. Load-bearing only alongside `mode`: taze searches the range that a dependency declares
  // before it consults this, and because a bare pin admits nothing, either setting alone reports nothing at all.
  includeLocked: true,
  // Search a pinned dependency's minors, which the range that it declares does not admit. Widens a `~` range to
  // `^` as well, and confines a `packageMode` entry to the passes whose mode matches it.
  mode: 'minor',
};

/**
 * Builds a taze configuration from nmr's shared upgrade policy and a repo's own settings.
 *
 * Any property that the caller supplies wins, including `0` and an explicit `undefined`, which clears nmr's
 * default and hands the setting back to taze. Clearing `mode` yields taze's own `'default'`, which follows each
 * declared range; passed through as `undefined`, it would overwrite taze's default and leave no valid range to
 * search.
 *
 * The policy leaves `maturityPeriod` unset, because taze inherits pnpm's `minimumReleaseAge` only while it is
 * unset. A repo that sets it replaces pnpm's period.
 *
 * The merge is shallow, which suits a policy of scalar defaults. A nested default would clobber rather
 * than merge, so adding one means revisiting this.
 */
export function defineConfig(config: TazeConfig): TazeConfig {
  const merged = { ...SHARED_POLICY, ...config };
  if ('mode' in config && config.mode === undefined) merged.mode = 'default';
  return merged;
}
