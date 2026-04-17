import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

import { pushRelease } from '../pushRelease.ts';
import type { ResolvedTag } from '../resolveReleaseTags.ts';

const TAGS: ResolvedTag[] = [
  { tag: 'core-v1.2.0', dir: 'core', workspacePath: 'packages/core' },
  { tag: 'cli-v0.5.0', dir: 'cli', workspacePath: 'packages/cli' },
];

describe(pushRelease, () => {
  beforeEach(() => {
    // Default: git rev-parse returns a branch name.
    mockExecFileSync.mockReturnValue('main\n');
  });

  afterEach(() => {
    mockExecFileSync.mockReset();
  });

  it('pushes branch then each tag individually', () => {
    pushRelease(TAGS);

    expect(mockExecFileSync).toHaveBeenCalledWith('git', ['rev-parse', '--abbrev-ref', 'HEAD'], expect.any(Object));
    expect(mockExecFileSync).toHaveBeenCalledWith('git', ['push', 'origin', 'main'], { stdio: 'inherit' });
    expect(mockExecFileSync).toHaveBeenCalledWith('git', ['push', '--no-follow-tags', 'origin', 'core-v1.2.0'], {
      stdio: 'inherit',
    });
    expect(mockExecFileSync).toHaveBeenCalledWith('git', ['push', '--no-follow-tags', 'origin', 'cli-v0.5.0'], {
      stdio: 'inherit',
    });
  });

  it('skips branch resolution and push when tagsOnly is true', () => {
    pushRelease(TAGS, { tagsOnly: true });

    expect(mockExecFileSync).not.toHaveBeenCalledWith('git', ['rev-parse', '--abbrev-ref', 'HEAD'], expect.anything());
    expect(mockExecFileSync).not.toHaveBeenCalledWith('git', ['push', 'origin', expect.any(String)], expect.anything());
  });

  it('does not execute git push in dry-run mode', () => {
    pushRelease(TAGS, { dryRun: true });

    expect(mockExecFileSync).not.toHaveBeenCalledWith('git', expect.arrayContaining(['push']), { stdio: 'inherit' });
  });

  it('still resolves branch name in dry-run mode', () => {
    pushRelease(TAGS, { dryRun: true });

    expect(mockExecFileSync).toHaveBeenCalledWith('git', ['rev-parse', '--abbrev-ref', 'HEAD'], expect.any(Object));
  });

  it('returns steps for branch and all tags', () => {
    const steps = pushRelease(TAGS);

    expect(steps).toEqual([
      { type: 'branch', ref: 'main', command: ['git', 'push', 'origin', 'main'] },
      { type: 'tag', ref: 'core-v1.2.0', command: ['git', 'push', '--no-follow-tags', 'origin', 'core-v1.2.0'] },
      { type: 'tag', ref: 'cli-v0.5.0', command: ['git', 'push', '--no-follow-tags', 'origin', 'cli-v0.5.0'] },
    ]);
  });

  it('returns only tag steps when tagsOnly is true', () => {
    const steps = pushRelease(TAGS, { tagsOnly: true });

    expect(steps).toEqual([
      { type: 'tag', ref: 'core-v1.2.0', command: ['git', 'push', '--no-follow-tags', 'origin', 'core-v1.2.0'] },
      { type: 'tag', ref: 'cli-v0.5.0', command: ['git', 'push', '--no-follow-tags', 'origin', 'cli-v0.5.0'] },
    ]);
  });

  it('returns steps without executing in dry-run mode', () => {
    const steps = pushRelease(TAGS, { dryRun: true });

    expect(steps).toHaveLength(3);
    expect(steps[0]).toEqual({ type: 'branch', ref: 'main', command: ['git', 'push', 'origin', 'main'] });
  });
});
