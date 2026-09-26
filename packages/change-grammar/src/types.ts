/** Whether a work type admits or forbids the breaking marker. */
export type BreakingPolicy = 'forbidden' | 'optional';

/** The full work-type taxonomy, of which the engine's `Taxonomy` input is the subset that it reads. */
export interface CanonicalTaxonomy extends Taxonomy {
  markers: { breaking: { emoji: string; label: string } };
  types: readonly CanonicalWorkTypeEntry[];
  version: string;
}

/** One work type with every field that the canonical taxonomy declares for it. */
export interface CanonicalWorkTypeEntry extends WorkTypeEntry {
  aliases: readonly string[];
  breakingPolicy: BreakingPolicy;
  description: string;
  emoji: string;
  excludedFromChangelog?: boolean;
  /** The changelog heading for the type. */
  label: string;
  /** The label name that a tracker applies to an issue or pull request of the type. */
  trackerLabel: string;
}

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
