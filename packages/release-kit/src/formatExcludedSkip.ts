import type { ResolvedTag } from './resolveReleaseTags.ts';

/** Formats the warning emitted when a release tag's workspace is excluded by config and therefore skipped. */
export function formatExcludedSkip(resolvedTag: Pick<ResolvedTag, 'tag' | 'workspacePath'>): string {
  return `Skipping ${resolvedTag.tag} (${resolvedTag.workspacePath}): excluded by config (shouldExclude: true).`;
}
