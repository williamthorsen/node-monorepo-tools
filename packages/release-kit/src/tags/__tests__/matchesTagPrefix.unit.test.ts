import { describe, expect, it } from 'vitest';

import { matchesTagPrefix } from '../matchesTagPrefix.ts';

describe(matchesTagPrefix, () => {
  it.each(['v1.0.0', 'v0.10.2', 'v1.0.0-beta.1', 'v1.0.0+build.5', 'v1.0.0-rc.1+build.5'])(
    'matches %s, whose suffix is a complete SemVer version',
    (tagName) => {
      expect(matchesTagPrefix(tagName, ['v'])).toBe(true);
    },
  );

  it.each(['v1', 'v1.2', 'v1.2.3.4', 'vnext', 'v1.0.0-', 'v11y-check-v1.0.0'])(
    'does not match %s, whose suffix is not a complete SemVer version',
    (tagName) => {
      expect(matchesTagPrefix(tagName, ['v'])).toBe(false);
    },
  );

  it('matches when any one of several prefixes fits', () => {
    expect(matchesTagPrefix('old-core-v0.2.7', ['core-v', 'old-core-v'])).toBe(true);
  });

  it('does not match a tag that starts with none of the prefixes', () => {
    expect(matchesTagPrefix('arrays-v1.0.0', ['core-v'])).toBe(false);
  });
});
