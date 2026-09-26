import { dropIncidentalRoot, splitScopes } from './tokens.ts';
import type { ChangeRecord, Taxonomy } from './types.ts';

/**
 * Derives the consolidated record of a branch's entries: the type that represents the branch, whether the branch is
 * breaking, and the scope if the entries agree on one.
 *
 * The type is the highest-ranked entry, never the most frequent one: breaking outranks non-breaking, then the tier's
 * position in the taxonomy, then the type's listing order within it. Ranking by frequency would let three routine
 * fixes outrank the one feature that the branch exists for.
 *
 * The scope is kept when exactly one distinct scope survives two filters. First, the scopes of entries in the
 * taxonomy's last tier are set aside whenever an entry of a higher tier names a scope: Process work such as a
 * dependency move supports the branch's change rather than describing it. Second, `root` is set aside whenever the
 * surviving scopes also name a workspace: `root` holds the files that support a workspace's change, so root work tied
 * to one workspace counts as that workspace's, as the commit conventions state. A branch naming two workspaces names no
 * scope, since none describes it, and a branch naming `root` alone keeps `root`. An entry whose scope names several
 * workspaces contributes each of them, so it counts exactly as the entries that name them one apiece do. An entry whose
 * type the taxonomy does not declare counts as higher-tier, and a one-tier taxonomy sets no entry's scope aside.
 */
export function consolidate(entries: readonly ChangeRecord[], taxonomy: Taxonomy): ChangeRecord {
  const consolidated: ChangeRecord = {};

  const hasScopedHigherTierEntry = entries.some(
    (entry) => !isLowestTier(entry, taxonomy) && splitScopes(entry.scope).length > 0,
  );
  const scopes = new Set<string>();
  for (const entry of entries) {
    if (hasScopedHigherTierEntry && isLowestTier(entry, taxonomy)) {
      continue;
    }
    for (const scope of splitScopes(entry.scope)) {
      scopes.add(scope);
    }
  }
  const surviving = dropIncidentalRoot(scopes);
  const [scope] = surviving;
  if (surviving.length === 1 && scope !== undefined) {
    consolidated.scope = scope;
  }

  let winner: RankedEntry | undefined;
  for (const entry of entries) {
    const ranked = rankEntry(entry, taxonomy);
    if (ranked !== undefined && (winner === undefined || outranks(ranked.rank, winner.rank))) {
      winner = { breaking: entry.breaking === true, key: ranked.key, rank: ranked.rank };
    }
  }
  if (winner !== undefined) {
    consolidated.type = winner.key;
    if (winner.breaking) {
      consolidated.breaking = true;
    }
  }

  return consolidated;
}

// region | Helpers

/** Reports whether the entry's type belongs to the last of several tiers, the one whose scopes yield to the others'. */
function isLowestTier(entry: ChangeRecord, taxonomy: Taxonomy): boolean {
  const lowest = taxonomy.tiers.at(-1);
  if (taxonomy.tiers.length < 2 || lowest === undefined) {
    return false;
  }
  return taxonomy.types.some((candidate) => candidate.key === entry.type && candidate.tier === lowest);
}

/** Reports whether `rank` beats `incumbent` on breaking, then tier, then listing order. */
function outranks(rank: Rank, incumbent: Rank): boolean {
  if (rank.breaking !== incumbent.breaking) {
    return rank.breaking < incumbent.breaking;
  }
  if (rank.tier !== incumbent.tier) {
    return rank.tier < incumbent.tier;
  }
  return rank.listing < incumbent.listing;
}

/**
 * Ranks one entry against the taxonomy, lower being stronger, and reports the canonical key that it named. Yields
 * nothing for a type omitted by the taxonomy, which no rank can place.
 */
function rankEntry(entry: ChangeRecord, taxonomy: Taxonomy): { key: string; rank: Rank } | undefined {
  const listing = taxonomy.types.findIndex((candidate) => candidate.key === entry.type);
  const workType = taxonomy.types[listing];
  if (workType === undefined) {
    return undefined;
  }
  const tier = taxonomy.tiers.indexOf(workType.tier);
  return {
    key: workType.key,
    rank: {
      breaking: entry.breaking === true ? 0 : 1,
      listing,
      tier: tier === -1 ? taxonomy.tiers.length : tier,
    },
  };
}

/** One entry's place in the ordering, each component lower-is-stronger. */
interface Rank {
  breaking: number;
  listing: number;
  tier: number;
}

/** The winning entry reduced to what the consolidated record needs from it. */
interface RankedEntry {
  breaking: boolean;
  key: string;
  rank: Rank;
}

// endregion | Helpers
