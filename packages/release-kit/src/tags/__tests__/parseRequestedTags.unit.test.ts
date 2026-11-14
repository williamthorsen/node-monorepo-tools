import { describe, expect, it } from 'vitest';

import { parseRequestedTags } from '../parseRequestedTags.ts';

describe(parseRequestedTags, () => {
  it('returns undefined when flag value is undefined', () => {
    expect(parseRequestedTags(undefined)).toBeUndefined();
  });

  it('returns undefined for empty-string input (--tags=)', () => {
    expect(parseRequestedTags('')).toBeUndefined();
  });

  it('returns undefined when input contains only commas (--tags=,,)', () => {
    expect(parseRequestedTags(',,')).toBeUndefined();
  });

  it('drops leading and trailing commas and returns the remaining tag', () => {
    expect(parseRequestedTags(',core-v1.0.0,')).toStrictEqual(['core-v1.0.0']);
  });

  it('returns a single-element array when a single tag is provided', () => {
    expect(parseRequestedTags('core-v1.0.0')).toStrictEqual(['core-v1.0.0']);
  });

  it('returns all tags in order for a comma-separated list', () => {
    expect(parseRequestedTags('core-v1.0.0,cli-v0.5.0,release-kit-v2.1.0')).toStrictEqual([
      'core-v1.0.0',
      'cli-v0.5.0',
      'release-kit-v2.1.0',
    ]);
  });
});
