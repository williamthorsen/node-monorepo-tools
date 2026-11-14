import type { ResolvedTag } from './resolveReleaseTags.ts';

/** Formats the warning emitted when a release tag's workspace is private and therefore skipped. */
export function formatPrivateSkip(resolvedTag: Pick<ResolvedTag, 'tag' | 'workspacePath'>): string {
  return `Skipping ${resolvedTag.tag} (${resolvedTag.workspacePath}): package.json#private is true.`;
}
