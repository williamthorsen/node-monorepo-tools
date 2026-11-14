import { describe, expect, it } from 'vitest';

import { detectUndeclaredTagPrefixes } from '../detectUndeclaredTagPrefixes.ts';
import type { Git } from '../git.ts';
import { makeFakeGit } from '../test-utils/fakeGit.ts';

describe(detectUndeclaredTagPrefixes, () => {
  it("returns an empty array when the repo doesn't have any tags", () => {
    const git = makeGitWithTags([]);

    expect(detectUndeclaredTagPrefixes(['core-v'], git)).toStrictEqual([]);
  });

  it('returns an empty array when every candidate prefix is known', () => {
    const git = makeGitWithTags(['core-v1.0.0', 'core-v1.1.0', 'arrays-v0.1.0']);

    expect(detectUndeclaredTagPrefixes(['core-v', 'arrays-v'], git)).toStrictEqual([]);
  });

  it('returns one entry per undeclared prefix with accurate tag count', () => {
    const git = makeGitWithTags(['core-v0.2.7', 'core-v0.2.8', 'arrays-v1.0.0']);

    const result = detectUndeclaredTagPrefixes(['arrays-v'], git);

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
    const git = makeGitWithTags(['zeta-v1.0.0', 'alpha-v1.0.0', 'alpha-v1.1.0']);

    const result = detectUndeclaredTagPrefixes([], git);

    expect(result.map((r) => r.prefix)).toStrictEqual(['alpha-v', 'zeta-v']);
  });

  it('caps exampleTags at the per-prefix limit', () => {
    const git = makeGitWithTags(['core-v0.1.0', 'core-v0.2.0', 'core-v0.3.0', 'core-v0.4.0', 'core-v0.5.0']);

    const result = detectUndeclaredTagPrefixes([], git);

    expect(result).toHaveLength(1);
    expect(result[0]?.tagCount).toBe(5);
    expect(result[0]?.exampleTags).toHaveLength(3);
  });

  it('accepts tags with a pre-release suffix', () => {
    const git = makeGitWithTags(['core-v1.0.0-beta.1', 'core-v1.0.0-rc.2']);

    const result = detectUndeclaredTagPrefixes([], git);

    expect(result[0]?.tagCount).toBe(2);
  });

  it('ignores tags that do not match the candidate pattern', () => {
    const git = makeGitWithTags(['release/v1', 'something-2.0', 'UPPER-v1.0.0', 'v1.0.0']);

    expect(detectUndeclaredTagPrefixes([], git)).toStrictEqual([]);
  });

  it('returns empty array when git invocation fails', () => {
    const git = makeFakeGit({
      listTags: () => {
        throw new Error('git not available');
      },
    });

    expect(detectUndeclaredTagPrefixes(['core-v'], git)).toStrictEqual([]);
  });

  it('derives suggestedDir by stripping the trailing -v from the prefix', () => {
    const git = makeGitWithTags(['my-cool-package-v1.0.0']);

    const result = detectUndeclaredTagPrefixes([], git);

    expect(result[0]?.suggestedDir).toBe('my-cool-package');
  });
});

// region | Helpers

/** Builds a `Git` that lists `tags`. */
function makeGitWithTags(tags: string[]): Git {
  return makeFakeGit({ listTags: () => tags });
}

// endregion | Helpers
