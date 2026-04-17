import { execFileSync } from 'node:child_process';

import type { ResolvedTag } from './resolveReleaseTags.ts';

export interface PushReleaseOptions {
  dryRun?: boolean;
  tagsOnly?: boolean;
}

export interface PushStep {
  type: 'branch' | 'tag';
  ref: string;
  command: readonly [string, ...string[]];
}

/**
 * Push the release commit and each tag individually so that GitHub Actions fires
 * a separate workflow run per tag.
 *
 * Returns the list of push steps that were executed (or would be executed in dry-run mode).
 */
export function pushRelease(resolvedTags: ResolvedTag[], options: PushReleaseOptions = {}): PushStep[] {
  const { dryRun = false, tagsOnly = false } = options;

  const steps: PushStep[] = [];

  if (!tagsOnly) {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const command = ['git', 'push', 'origin', branch] as const;
    steps.push({ type: 'branch', ref: branch, command });
  }

  for (const { tag } of resolvedTags) {
    const command = ['git', 'push', '--no-follow-tags', 'origin', tag] as const;
    steps.push({ type: 'tag', ref: tag, command });
  }

  if (!dryRun) {
    for (const step of steps) {
      execFileSync(step.command[0], step.command.slice(1), { stdio: 'inherit' });
    }
  }

  return steps;
}
