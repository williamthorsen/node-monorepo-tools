import { UserError } from '@williamthorsen/nmr-core';
import { describe, expect, it } from 'vitest';

import { pushRelease } from '../pushRelease.ts';
import type { ResolvedTag } from '../resolveReleaseTags.ts';
import { makeFakeGit } from '../test-utils/fakeGit.ts';

const TAGS: ResolvedTag[] = [
  { tag: 'core-v1.2.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
  { tag: 'cli-v0.5.0', kind: 'package', dir: 'cli', workspacePath: 'packages/cli', isPublishable: true },
];

describe(pushRelease, () => {
  it('pushes the branch, then each tag individually', () => {
    const git = makeFakeGit();

    pushRelease(TAGS, {}, git);

    expect(git.pushBranch).toHaveBeenCalledExactlyOnceWith('main');
    expect(git.pushTag.mock.calls).toStrictEqual([['core-v1.2.0'], ['cli-v0.5.0']]);
    expect(git.pushBranch.mock.invocationCallOrder[0]).toBeLessThan(git.pushTag.mock.invocationCallOrder[0] ?? 0);
  });

  it('skips branch resolution and push when tagsOnly is true', () => {
    const git = makeFakeGit();

    pushRelease(TAGS, { tagsOnly: true }, git);

    expect(git.readCurrentBranch).not.toHaveBeenCalled();
    expect(git.pushBranch).not.toHaveBeenCalled();
    expect(git.pushTag).toHaveBeenCalledTimes(2);
  });

  it('does not push in dry-run mode, but still resolves the branch name', () => {
    const git = makeFakeGit();

    pushRelease(TAGS, { isDryRun: true }, git);

    expect(git.readCurrentBranch).toHaveBeenCalledOnce();
    expect(git.pushBranch).not.toHaveBeenCalled();
    expect(git.pushTag).not.toHaveBeenCalled();
  });

  it('returns steps for branch and all tags', () => {
    const steps = pushRelease(TAGS, {}, makeFakeGit());

    expect(steps).toStrictEqual([
      { type: 'branch', ref: 'main', command: ['git', 'push', 'origin', 'main'] },
      { type: 'tag', ref: 'core-v1.2.0', command: ['git', 'push', '--no-follow-tags', 'origin', 'core-v1.2.0'] },
      { type: 'tag', ref: 'cli-v0.5.0', command: ['git', 'push', '--no-follow-tags', 'origin', 'cli-v0.5.0'] },
    ]);
  });

  it('returns only tag steps when tagsOnly is true', () => {
    const steps = pushRelease(TAGS, { tagsOnly: true }, makeFakeGit());

    expect(steps).toStrictEqual([
      { type: 'tag', ref: 'core-v1.2.0', command: ['git', 'push', '--no-follow-tags', 'origin', 'core-v1.2.0'] },
      { type: 'tag', ref: 'cli-v0.5.0', command: ['git', 'push', '--no-follow-tags', 'origin', 'cli-v0.5.0'] },
    ]);
  });

  it('returns steps without executing in dry-run mode', () => {
    const steps = pushRelease(TAGS, { isDryRun: true }, makeFakeGit());

    expect(steps).toHaveLength(3);
    expect(steps[0]).toStrictEqual({ type: 'branch', ref: 'main', command: ['git', 'push', 'origin', 'main'] });
  });

  it('rethrows a failed push as a user error', () => {
    const git = makeFakeGit({
      pushTag: () => {
        throw new Error('rejected');
      },
    });

    expect(() => pushRelease(TAGS, {}, git)).toThrow(UserError);
  });
});
