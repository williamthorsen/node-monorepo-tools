import type { WorkTypeConfig } from '../types.ts';

/** Work types, some with aliases, against which the commit-parsing tests resolve a subject's type. */
export const workTypes: Record<string, WorkTypeConfig> = {
  fix: { header: 'Bug fixes', aliases: ['bugfix'] },
  feat: { header: 'Features', aliases: ['feature'] },
  refactor: { header: 'Refactoring' },
  docs: { header: 'Documentation', aliases: ['doc'] },
};
