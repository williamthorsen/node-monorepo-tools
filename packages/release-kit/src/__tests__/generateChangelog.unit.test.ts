import { describe, expect, it } from 'vitest';

import { buildTagPattern } from '../generateChangelogs.ts';

describe(buildTagPattern, () => {
  it('constructs a tag pattern from a single-package prefix', () => {
    expect(buildTagPattern(['v'])).toBe('v[0-9].*');
  });

  it('constructs a tag pattern from a monorepo workspace prefix', () => {
    expect(buildTagPattern(['release-kit-v'])).toBe('release-kit-v[0-9].*');
  });

  it('builds an alternation group when given multiple prefixes', () => {
    expect(buildTagPattern(['nmr-core-v', 'core-v'])).toBe('(nmr-core-v|core-v)[0-9].*');
  });

  it('escapes regex metacharacters in prefix entries', () => {
    expect(buildTagPattern(['foo.v', 'bar-v'])).toBe(String.raw`(foo\.v|bar-v)[0-9].*`);
  });

  it('throws when given an empty array', () => {
    expect(() => buildTagPattern([])).toThrow('buildTagPattern: tagPrefixes must contain at least one entry');
  });
});
