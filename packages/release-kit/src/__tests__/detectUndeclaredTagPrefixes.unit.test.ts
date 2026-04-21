import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

import { detectUndeclaredTagPrefixes } from '../detectUndeclaredTagPrefixes.ts';

/** Configure the mock to return the given tags from `git tag --list`. */
function setupTagList(tags: string[]): void {
  mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
    if (cmd === 'git' && args[0] === 'tag' && args[1] === '--list') {
      return tags.join('\n') + (tags.length > 0 ? '\n' : '');
    }
    return '';
  });
}

describe(detectUndeclaredTagPrefixes, () => {
  afterEach(() => {
    mockExecFileSync.mockReset();
  });

  it('returns an empty array when the repo has no tags', () => {
    setupTagList([]);

    expect(detectUndeclaredTagPrefixes(['core-v'])).toStrictEqual([]);
  });

  it('returns an empty array when every candidate prefix is known', () => {
    setupTagList(['core-v1.0.0', 'core-v1.1.0', 'arrays-v0.1.0']);

    expect(detectUndeclaredTagPrefixes(['core-v', 'arrays-v'])).toStrictEqual([]);
  });

  it('returns one entry per undeclared prefix with accurate tag count', () => {
    setupTagList(['core-v0.2.7', 'core-v0.2.8', 'arrays-v1.0.0']);

    const result = detectUndeclaredTagPrefixes(['arrays-v']);

    expect(result).toStrictEqual([
      {
        prefix: 'core-v',
        tagCount: 2,
        exampleTags: ['core-v0.2.7', 'core-v0.2.8'],
        suggestedDir: 'core',
      },
    ]);
  });

  it('returns multiple entries sorted by prefix when several undeclared prefixes exist', () => {
    setupTagList(['zeta-v1.0.0', 'alpha-v1.0.0', 'alpha-v1.1.0']);

    const result = detectUndeclaredTagPrefixes([]);

    expect(result.map((r) => r.prefix)).toStrictEqual(['alpha-v', 'zeta-v']);
  });

  it('caps exampleTags at the per-prefix limit', () => {
    setupTagList(['core-v0.1.0', 'core-v0.2.0', 'core-v0.3.0', 'core-v0.4.0', 'core-v0.5.0']);

    const result = detectUndeclaredTagPrefixes([]);

    expect(result).toHaveLength(1);
    expect(result[0]?.tagCount).toBe(5);
    expect(result[0]?.exampleTags).toHaveLength(3);
  });

  it('accepts tags with a pre-release suffix', () => {
    setupTagList(['core-v1.0.0-beta.1', 'core-v1.0.0-rc.2']);

    const result = detectUndeclaredTagPrefixes([]);

    expect(result[0]?.tagCount).toBe(2);
  });

  it('ignores tags that do not match the candidate pattern', () => {
    setupTagList(['release/v1', 'something-2.0', 'UPPER-v1.0.0', 'v1.0.0']);

    expect(detectUndeclaredTagPrefixes([])).toStrictEqual([]);
  });

  it('returns empty array when git invocation fails', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('git not available');
    });

    expect(detectUndeclaredTagPrefixes(['core-v'])).toStrictEqual([]);
  });

  it('derives suggestedDir by stripping the trailing -v from the prefix', () => {
    setupTagList(['my-cool-package-v1.0.0']);

    const result = detectUndeclaredTagPrefixes([]);

    expect(result[0]?.suggestedDir).toBe('my-cool-package');
  });
});
