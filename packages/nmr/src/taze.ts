import type { CheckOptions } from 'taze';

/**
 * A taze configuration.
 *
 * Every property admits `undefined` explicitly, unlike `Partial<CheckOptions>`, which rejects it under
 * `exactOptionalPropertyTypes`. Passing `undefined` is how a consumer clears `maturityPeriod`, so the type
 * has to allow it.
 */
export type TazeConfig = { [K in keyof CheckOptions]?: CheckOptions[K] | undefined };

/**
 * Upgrade policy that nmr applies to every consumer, leaving a repo's own config to contain only what is local to
 * it.
 */
const SHARED_POLICY: TazeConfig = {
  // Report a dependency pinned to a bare version, which a repo using pnpm's `savePrefix: ''` declares for
  // every one of them. Load-bearing only alongside `mode`: taze searches the range that a dependency declares
  // before it consults this, and because a bare pin admits nothing, either setting alone reports nothing at all.
  includeLocked: true,
  // Quarantine brand-new releases for a week as supply-chain hygiene. Declaring it at all also stops taze
  // from inheriting pnpm's shorter `minimumReleaseAge`; the `minimumReleaseAgeExclude` list is inherited
  // either way, so first-party packages stay exempt.
  maturityPeriod: 7,
  // Search a pinned dependency's minors, which the range that it declares does not admit. Widens a `~` range to
  // `^` as well, and confines a `packageMode` entry to the passes whose mode matches it.
  mode: 'minor',
};

/**
 * Builds a taze configuration from nmr's shared upgrade policy and a repo's own settings.
 *
 * Any property that the caller supplies wins, including `0` and an explicit `undefined`. The latter restores
 * taze's inheritance of pnpm's `minimumReleaseAge`, which only applies while `maturityPeriod` is unset.
 *
 * The merge is shallow, which suits a policy of scalar defaults. A nested default would clobber rather
 * than merge, so adding one means revisiting this.
 */
export function defineConfig(config: TazeConfig): TazeConfig {
  return { ...SHARED_POLICY, ...config };
}
