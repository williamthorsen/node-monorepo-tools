import type { ResolvedTag } from './resolveReleaseTags.ts';

/** Formats the warning emitted when `publish` is asked for a directory target's tag, which is never published. */
export function formatDirectoryPublishSkip(resolvedTag: Pick<ResolvedTag, 'dir' | 'tag'>): string {
  return `Skipping ${resolvedTag.tag}: directory release '${resolvedTag.dir}' is not published to a registry.`;
}
