import type { ResolvedTag } from './resolveReleaseTags.ts';

/**
 * Formats the warning emitted when a release tag's workspace is excluded by config and therefore skipped, naming the
 * `setting` that excluded it, which defaults to the `workspaces` override form.
 */
export function formatExcludedSkip(
  resolvedTag: Pick<ResolvedTag, 'tag' | 'workspacePath'>,
  setting = 'shouldExclude: true',
): string {
  return `Skipping ${resolvedTag.tag} (${resolvedTag.workspacePath}): excluded by config (${setting}).`;
}
