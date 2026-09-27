import type { CanonicalWorkTypeEntry } from '@williamthorsen/change-grammar';

import type { LabelDefinition } from './types.ts';

/** Color given to the label of a type whose tier has no default color. */
const FALLBACK_COLOR = 'ededed';

/** Color given to the label of a type that has no presentation row, by the type's tier. */
const TIER_DEFAULT_COLORS: Readonly<Record<string, string>> = {
  internal: '1d76db',
  process: 'edc287',
  public: '0075ca',
};

/**
 * Builds one label per work type, named by the type's tracker label. A type without a presentation row gets its
 * tier's default color and no description.
 */
export function deriveTypeLabels(taxonomy: {
  types: readonly Pick<CanonicalWorkTypeEntry, 'key' | 'tier' | 'trackerLabel'>[];
}): LabelDefinition[] {
  return taxonomy.types.map(({ key, tier, trackerLabel }) => {
    const presentation = TYPE_LABEL_PRESENTATION[key];
    if (presentation === undefined) {
      return { name: trackerLabel, color: TIER_DEFAULT_COLORS[tier] ?? FALLBACK_COLOR };
    }
    return { name: trackerLabel, ...presentation };
  });
}

/** Color and description of each work type's label, keyed by work-type key. Descriptions fit GitHub's 100 characters. */
export const TYPE_LABEL_PRESENTATION: Readonly<Record<string, { color: string; description: string }>> = {
  ai: {
    color: 'a2eeef',
    description: 'Guidance on working in this repo, such as its AGENTS.md or a repo-local skill, or its agent config',
  },
  ci: { color: 'edc287', description: 'CI/CD tooling & configuration' },
  deprecate: { color: 'fbca04', description: 'Marks functionality for future removal' },
  deps: { color: 'edc287', description: 'Change to dependencies' },
  docs: {
    color: 'a2eeef',
    description: 'Documentation for human readers, such as a README, a guide, or a code comment',
  },
  drop: { color: 'd93f0b', description: 'Removes functionality that consumers depend on' },
  feat: { color: '0075ca', description: 'Added or improved external functionality' },
  fix: { color: 'd73a4a', description: 'Fixes a bug' },
  fmt: { color: 'edc287', description: 'Formatting only, with no change to content' },
  internal: { color: '1d76db', description: 'Internal change without external impact' },
  perf: { color: '0075ca', description: 'Improves performance without changing behavior' },
  refactor: { color: 'edc287', description: 'Improvement to code without change in functionality' },
  sec: { color: 'b60205', description: 'Security vulnerability or hardening' },
  tests: { color: 'edc287', description: 'Tests' },
  tooling: { color: 'edc287', description: 'Development tools' },
};
