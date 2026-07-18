import type { ResolvedTag } from './resolveReleaseTags.ts';

/**
 * Format the warning emitted when a release tag's workspace is private and therefore skipped.
 *
 * Shared by `release-kit publish` and `release-kit create-github-release` so the skip wording
 * is defined once and stays identical across both commands.
 */
export function formatPrivateSkip(resolvedTag: Pick<ResolvedTag, 'tag' | 'workspacePath'>): string {
  return `Skipping ${resolvedTag.tag} (${resolvedTag.workspacePath}): package.json#private is true.`;
}
