/**
 * Canonical work-types data: the runtime mirror of `work-types.json`.
 *
 * `work-types.json` is release-kit's copy of the codeassembly canonical. This `.ts` mirror exists for
 * runtime consumption: The compiler baseline does not enable JSON module imports, and a TS constant keeps
 * `breakingPolicy` typed as its three-value union.
 *
 * A drift test (`workTypesData.unit.test.ts`) asserts that this constant deep-equals the parsed contents
 * of `work-types.json`, so a change to the JSON is copied here by hand.
 */

/** Schema for a single entry. */
export interface WorkTypeEntry {
  tier: string;
  key: string;
  aliases: string[];
  emoji: string;
  label: string;
  description: string;
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
  /** Semantic version of the data shape, as declared by the upstream canonical. */
  version: string;
  tiers: string[];
  types: WorkTypeEntry[];
  /**
   * Cross-cutting section markers keyed by marker name. The `breaking` marker is
   * canonical and required; additional keys are permitted for forward-compatibility.
   */
  markers: {
    [key: string]: MarkerEntry;
    breaking: MarkerEntry;
  };
}

/** Canonical work-types data, kept in lockstep with `work-types.json`. */
export const WORK_TYPES_DATA: WorkTypesData = {
  version: '1.1.0',
  tiers: ['public', 'internal', 'process'],
  types: [
    {
      tier: 'public',
      key: 'feat',
      aliases: ['feature'],
      emoji: '🎉',
      label: 'Features',
      description: 'A change that gives consumers a new capability or extends an existing one.',
      breakingPolicy: 'optional',
    },
    {
      tier: 'public',
      key: 'drop',
      aliases: [],
      emoji: '🪦',
      label: 'Removed',
      description: 'A change that removes a capability or surface on which consumers depend.',
      breakingPolicy: 'required',
    },
    {
      tier: 'public',
      key: 'deprecate',
      aliases: [],
      emoji: '🗑️',
      label: 'Deprecated',
      description:
        'A change that marks a capability or surface for removal while the capability or surface keeps working.',
      breakingPolicy: 'forbidden',
    },
    {
      tier: 'public',
      key: 'fix',
      aliases: ['bugfix'],
      emoji: '🐛',
      label: 'Bug fixes',
      description: 'A change that corrects behavior that consumers meet and that differs from what was intended.',
      breakingPolicy: 'optional',
    },
    {
      tier: 'public',
      key: 'sec',
      aliases: ['security'],
      emoji: '🔒',
      label: 'Security',
      description: 'A change that closes a vulnerability or hardens a consumer-facing surface against attack.',
      breakingPolicy: 'optional',
    },
    {
      tier: 'public',
      key: 'perf',
      aliases: ['performance'],
      emoji: '⚡',
      label: 'Performance',
      description:
        'A change that reduces the time, memory, or other resources that consumer-facing work uses, without changing its result.',
      breakingPolicy: 'optional',
    },
    {
      tier: 'internal',
      key: 'internal',
      aliases: ['utility'],
      emoji: '🏗️',
      label: 'Internal features',
      description:
        'A change that adds or extends a capability that consumers do not use directly, such as a helper or an internal module.',
      breakingPolicy: 'forbidden',
    },
    {
      tier: 'internal',
      key: 'refactor',
      aliases: [],
      emoji: '♻️',
      label: 'Refactoring',
      description: 'A change that restructures existing code without changing its behavior.',
      breakingPolicy: 'forbidden',
    },
    {
      tier: 'internal',
      key: 'tests',
      aliases: ['test'],
      emoji: '🧪',
      label: 'Tests',
      description:
        'A change confined to tests, test fixtures, or test helpers, including one that unblocks a build or a type check.',
      breakingPolicy: 'forbidden',
    },
    {
      tier: 'process',
      key: 'tooling',
      aliases: [],
      emoji: '⚙️',
      label: 'Tooling',
      description:
        'A change to the tools used to develop the project: build, lint, formatting, and release configuration, and development scripts.',
      breakingPolicy: 'forbidden',
    },
    {
      tier: 'process',
      key: 'ci',
      aliases: [],
      emoji: '👷',
      label: 'CI',
      description: 'A change to continuous-integration workflows and their configuration.',
      breakingPolicy: 'forbidden',
    },
    {
      tier: 'process',
      key: 'deps',
      aliases: ['dep'],
      emoji: '📦',
      label: 'Dependencies',
      description:
        'A change that adds, removes, or upgrades a dependency, including its lockfile and version-catalog entries.',
      breakingPolicy: 'forbidden',
    },
    {
      tier: 'process',
      key: 'ai',
      aliases: [],
      emoji: '🤖',
      label: 'Agentic support',
      description:
        "A change to guidance on working in the repository itself, such as its `AGENTS.md` or a repo-local skill, or to the repository's agent configuration.",
      breakingPolicy: 'forbidden',
    },
    {
      tier: 'process',
      key: 'docs',
      aliases: ['doc'],
      emoji: '📚',
      label: 'Documentation',
      description: 'A change to documentation for human readers, such as a README, a guide, or a code comment.',
      breakingPolicy: 'forbidden',
    },
    {
      tier: 'process',
      key: 'fmt',
      aliases: [],
      emoji: '🎨',
      label: 'Formatting',
      description:
        'A change to formatting alone, such as whitespace or line wrapping, that leaves the content unchanged.',
      breakingPolicy: 'forbidden',
      excludedFromChangelog: true,
    },
  ],
  markers: {
    breaking: { emoji: '🚨', label: 'Breaking' },
  },
};
