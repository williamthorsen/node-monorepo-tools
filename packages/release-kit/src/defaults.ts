import type { VersionPatterns, WorkTypeConfig } from './types.ts';

/** Default work types ordered by priority, matching the skypilot-site convention. */
export const DEFAULT_WORK_TYPES: Record<string, WorkTypeConfig> = {
  fix: { header: 'Bug fixes', aliases: ['bugfix'] },
  feat: { header: 'Features', aliases: ['feature'] },
  internal: { header: 'Internal' },
  refactor: { header: 'Refactoring' },
  tests: { header: 'Tests', aliases: ['test'] },
  tooling: { header: 'Tooling' },
  ci: { header: 'CI' },
  deps: { header: 'Dependencies', aliases: ['dep'] },
  docs: { header: 'Documentation', aliases: ['doc'] },
  fmt: { header: 'Formatting' },
};

/** Default version bump patterns. */
export const DEFAULT_VERSION_PATTERNS: VersionPatterns = {
  major: ['!'],
  minor: ['feat', 'feature'],
};
