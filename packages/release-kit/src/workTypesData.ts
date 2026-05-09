/**
 * Canonical work-types data — runtime mirror of `work-types.json`.
 *
 * `work-types.json` is the canonical SSOT for the taxonomy and is the file
 * `release-kit work-types check` / `:sync` operate on. This `.ts` mirror exists for
 * runtime consumption: ESM JSON imports require an `import attributes` clause that
 * esbuild's `bundle: false` mode strips, so a plain TS module is the most reliable way
 * to ship the data to consumers.
 *
 * A drift test (`workTypesData.unit.test.ts`) asserts that this constant deep-equals the
 * parsed contents of `work-types.json`. To change the taxonomy, edit BOTH files (or run
 * `nmr work-types:sync` to pull from upstream).
 */

/** Schema for a single entry. */
export interface WorkTypeEntry {
  tier: string;
  key: string;
  aliases: string[];
  emoji: string;
  label: string;
  breakingPolicy: 'forbidden' | 'optional' | 'required';
  excludedFromChangelog?: boolean;
}

/**
 * Schema for an orthogonal section marker (e.g., breaking-changes indicator).
 *
 * Stored as plain text — consumers add formatting (bold, prefix punctuation) when
 * constructing the rendered form. Keeps the SSOT format-agnostic across Markdown,
 * HTML, terminal, and plain-text consumers.
 */
export interface MarkerEntry {
  emoji: string;
  label: string;
}

/** Schema for the full data. */
export interface WorkTypesData {
  tiers: string[];
  types: WorkTypeEntry[];
  /**
   * Cross-cutting section markers keyed by marker name. The `breaking` marker is
   * canonical and required; additional keys are permitted for forward-compatibility.
   */
  markers: {
    breaking: MarkerEntry;
    [key: string]: MarkerEntry;
  };
}

/** Canonical work-types data, kept in lockstep with `work-types.json`. */
export const WORK_TYPES_DATA: WorkTypesData = {
  tiers: ['public', 'internal', 'process'],
  types: [
    { tier: 'public', key: 'feat', aliases: ['feature'], emoji: '🎉', label: 'Features', breakingPolicy: 'optional' },
    { tier: 'public', key: 'drop', aliases: [], emoji: '🪦', label: 'Removed', breakingPolicy: 'required' },
    { tier: 'public', key: 'deprecate', aliases: [], emoji: '🗑️', label: 'Deprecated', breakingPolicy: 'forbidden' },
    { tier: 'public', key: 'fix', aliases: ['bugfix'], emoji: '🐛', label: 'Bug fixes', breakingPolicy: 'forbidden' },
    { tier: 'public', key: 'sec', aliases: ['security'], emoji: '🔒', label: 'Security', breakingPolicy: 'optional' },
    {
      tier: 'public',
      key: 'perf',
      aliases: ['performance'],
      emoji: '⚡',
      label: 'Performance',
      breakingPolicy: 'forbidden',
    },
    {
      tier: 'internal',
      key: 'internal',
      aliases: ['utility'],
      emoji: '🏗️',
      label: 'Internal features',
      breakingPolicy: 'forbidden',
    },
    {
      tier: 'internal',
      key: 'refactor',
      aliases: [],
      emoji: '♻️',
      label: 'Refactoring',
      breakingPolicy: 'forbidden',
    },
    { tier: 'internal', key: 'tests', aliases: ['test'], emoji: '🧪', label: 'Tests', breakingPolicy: 'forbidden' },
    { tier: 'process', key: 'tooling', aliases: [], emoji: '⚙️', label: 'Tooling', breakingPolicy: 'forbidden' },
    { tier: 'process', key: 'ci', aliases: [], emoji: '👷', label: 'CI', breakingPolicy: 'forbidden' },
    { tier: 'process', key: 'deps', aliases: ['dep'], emoji: '📦', label: 'Dependencies', breakingPolicy: 'forbidden' },
    { tier: 'process', key: 'ai', aliases: [], emoji: '🤖', label: 'Agentic support', breakingPolicy: 'forbidden' },
    {
      tier: 'process',
      key: 'docs',
      aliases: ['doc'],
      emoji: '📚',
      label: 'Documentation',
      breakingPolicy: 'forbidden',
    },
    {
      tier: 'process',
      key: 'fmt',
      aliases: [],
      emoji: '🎨',
      label: 'Formatting',
      breakingPolicy: 'forbidden',
      excludedFromChangelog: true,
    },
  ],
  markers: {
    breaking: { emoji: '🚨', label: 'Breaking' },
  },
};
