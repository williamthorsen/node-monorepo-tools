import type { CheckOptions } from 'taze';

/**
 * A taze configuration.
 *
 * Every property admits `undefined` explicitly, unlike `Partial<CheckOptions>`, which rejects it under
 * `exactOptionalPropertyTypes`. Passing `undefined` is how a consumer clears one of nmr's defaults, so
 * the type has to allow it.
 */
export type TazeConfig = { [K in keyof CheckOptions]?: CheckOptions[K] | undefined };

/**
 * Upgrade policy nmr applies to every consumer, so a repo's own config carries only what is local to it.
 */
const SHARED_POLICY: TazeConfig = {
  // Quarantine brand-new releases for a week as supply-chain hygiene. Declaring it at all is also what
  // stops taze from inheriting pnpm's shorter `minimumReleaseAge`; the `minimumReleaseAgeExclude` list is
  // inherited either way, so first-party packages stay exempt.
  maturityPeriod: 7,
};

/**
 * Builds a taze configuration from nmr's shared upgrade policy and a repo's own settings.
 *
 * Any property the caller supplies wins, including `0` and an explicit `undefined` — the latter restores
 * taze's inheritance of pnpm's `minimumReleaseAge`, which only applies while `maturityPeriod` is unset.
 *
 * The merge is shallow, which suits a policy of scalar defaults. A nested default would clobber rather
 * than merge, so adding one means revisiting this.
 */
export function defineConfig(config: TazeConfig): TazeConfig {
  return { ...SHARED_POLICY, ...config };
}
