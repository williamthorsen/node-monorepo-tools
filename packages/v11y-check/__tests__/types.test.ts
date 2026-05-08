import { describe, expect, it } from 'vitest';

import { isSeverityAtOrAbove } from '../src/types.ts';

describe(isSeverityAtOrAbove, () => {
  it.each([
    ['critical', 'low', true],
    ['critical', 'moderate', true],
    ['critical', 'high', true],
    ['critical', 'critical', true],
    ['high', 'low', true],
    ['high', 'moderate', true],
    ['high', 'high', true],
    ['high', 'critical', false],
    ['moderate', 'low', true],
    ['moderate', 'moderate', true],
    ['moderate', 'high', false],
    ['moderate', 'critical', false],
    ['low', 'low', true],
    ['low', 'moderate', false],
    ['low', 'high', false],
    ['low', 'critical', false],
  ] as const)('returns %s for severity "%s" with threshold "%s"', (severity, threshold, expected) => {
    expect(isSeverityAtOrAbove(severity, threshold)).toBe(expected);
  });

  it('returns true for undefined severity (conservative default)', () => {
    expect(isSeverityAtOrAbove(undefined, 'critical')).toBe(true);
  });

  it('returns true for unrecognized severity (conservative default)', () => {
    expect(isSeverityAtOrAbove('unknown', 'low')).toBe(true);
  });
});
