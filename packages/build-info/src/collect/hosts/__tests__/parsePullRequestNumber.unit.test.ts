import { describe, expect, it } from 'vitest';

import { parsePullRequestNumber } from '../parsePullRequestNumber.ts';

describe(parsePullRequestNumber, () => {
  it.each([
    [42, 42],
    ['42', 42],
  ])('parses %j', (value, expected) => {
    expect(parsePullRequestNumber(value)).toBe(expected);
  });

  it.each([undefined, '', '0', '-1', '4.2', '42abc', 0, 4.2, null])('rejects %j', (value) => {
    expect(parsePullRequestNumber(value)).toBeUndefined();
  });
});
