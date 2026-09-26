/** Whether a work type admits or forbids the breaking marker. */
export type BreakingPolicy = 'forbidden' | 'optional';

/**
 * The values from which a surface template renders, and the values that a parse returns. Every field is optional: A
 * template names only the tokens that its convention includes, and a field omitted by the record resolves to empty.
 */
export interface ChangeRecord {
  breaking?: boolean;
  prNumber?: string;
  scope?: string;
  ticketRef?: string;
  title?: string;
  type?: string;
}

/**
 * The work-type taxonomy that the engine is given rather than reads. `tiers` and the order of `types` together rank the
 * entries, so a caller supplying the taxonomy also supplies the ranking.
 */
export interface Taxonomy {
  tiers: readonly string[];
  types: readonly WorkTypeEntry[];
}

/** One work type as the taxonomy declares it. */
export interface WorkTypeEntry {
  aliases?: readonly string[];
  breakingPolicy?: BreakingPolicy;
  key: string;
  tier: string;
}
