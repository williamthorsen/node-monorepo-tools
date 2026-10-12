import type { ResolvedTag } from './resolveReleaseTags.ts';

/** Formats the warning emitted when `publish` is asked for a project tag, which does not have an npm package. */
export function formatProjectPublishSkip(resolvedTag: Pick<ResolvedTag, 'tag'>): string {
  return `Skipping ${resolvedTag.tag}: a project tag is not an npm package.`;
}
