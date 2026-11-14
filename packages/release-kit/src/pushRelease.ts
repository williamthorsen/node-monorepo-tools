import { buildBranchPushArgs, buildTagPushArgs, type Git, realGit } from './git.ts';
import type { ResolvedTag } from './resolveReleaseTags.ts';
import { asUserError } from './user-error-chaining.ts';

export interface PushReleaseOptions {
  isDryRun?: boolean;
  tagsOnly?: boolean;
}

export interface PushStep {
  type: 'branch' | 'tag';
  ref: string;
  command: readonly [string, ...string[]];
}

/**
 * Pushes the release commit and each tag individually so that GitHub Actions fires
 * a separate workflow run per tag.
 *
 * Returns the push steps, which it runs only outside dry-run mode.
 */
export function pushRelease(
  resolvedTags: ResolvedTag[],
  options: PushReleaseOptions = {},
  git: Git = realGit,
): PushStep[] {
  const { isDryRun = false, tagsOnly = false } = options;

  const steps: PushStep[] = [];

  if (!tagsOnly) {
    let branch: string;
    try {
      branch = git.readCurrentBranch();
    } catch (error: unknown) {
      throw asUserError(error);
    }

    const command: PushStep['command'] = ['git', ...buildBranchPushArgs(branch)];
    steps.push({ type: 'branch', ref: branch, command });
  }

  for (const { tag } of resolvedTags) {
    const command: PushStep['command'] = ['git', ...buildTagPushArgs(tag)];
    steps.push({ type: 'tag', ref: tag, command });
  }

  if (!isDryRun) {
    for (const step of steps) {
      try {
        if (step.type === 'branch') {
          git.pushBranch(step.ref);
        } else {
          git.pushTag(step.ref);
        }
      } catch (error: unknown) {
        throw asUserError(error);
      }
    }
  }

  return steps;
}
