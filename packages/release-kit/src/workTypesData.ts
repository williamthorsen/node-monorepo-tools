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

/** Schema for the full data. */
export interface WorkTypesData {
  tiers: string[];
  types: WorkTypeEntry[];
}

/** Canonical work-types data, kept in lockstep with `work-types.json`. */
export const WORK_TYPES_DATA: WorkTypesData = {
  tiers: ['Public', 'Internal', 'Process'],
  types: [
    { tier: 'Public', key: 'feat', aliases: ['feature'], emoji: '🎉', label: 'Features', breakingPolicy: 'optional' },
    { tier: 'Public', key: 'drop', aliases: [], emoji: '🪦', label: 'Removed', breakingPolicy: 'required' },
    { tier: 'Public', key: 'deprecate', aliases: [], emoji: '🗑️', label: 'Deprecated', breakingPolicy: 'forbidden' },
    { tier: 'Public', key: 'fix', aliases: ['bugfix'], emoji: '🐛', label: 'Bug fixes', breakingPolicy: 'forbidden' },
    { tier: 'Public', key: 'sec', aliases: ['security'], emoji: '🔒', label: 'Security', breakingPolicy: 'optional' },
    {
      tier: 'Public',
      key: 'perf',
      aliases: ['performance'],
      emoji: '⚡',
      label: 'Performance',
      breakingPolicy: 'forbidden',
    },
    {
      tier: 'Internal',
      key: 'internal',
      aliases: ['utility'],
      emoji: '🏗️',
      label: 'Internal features',
      breakingPolicy: 'forbidden',
    },
    {
      tier: 'Internal',
      key: 'refactor',
      aliases: [],
      emoji: '♻️',
      label: 'Refactoring',
      breakingPolicy: 'forbidden',
    },
    { tier: 'Internal', key: 'tests', aliases: ['test'], emoji: '🧪', label: 'Tests', breakingPolicy: 'forbidden' },
    { tier: 'Process', key: 'tooling', aliases: [], emoji: '⚙️', label: 'Tooling', breakingPolicy: 'forbidden' },
    { tier: 'Process', key: 'ci', aliases: [], emoji: '👷', label: 'CI', breakingPolicy: 'forbidden' },
    { tier: 'Process', key: 'deps', aliases: ['dep'], emoji: '📦', label: 'Dependencies', breakingPolicy: 'forbidden' },
    { tier: 'Process', key: 'ai', aliases: [], emoji: '🤖', label: 'Agentic support', breakingPolicy: 'forbidden' },
    {
      tier: 'Process',
      key: 'docs',
      aliases: ['doc'],
      emoji: '📚',
      label: 'Documentation',
      breakingPolicy: 'forbidden',
    },
    {
      tier: 'Process',
      key: 'fmt',
      aliases: [],
      emoji: '🎨',
      label: 'Formatting',
      breakingPolicy: 'forbidden',
      excludedFromChangelog: true,
    },
  ],
};
