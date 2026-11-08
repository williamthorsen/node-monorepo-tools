import { describe, expect, it } from 'vitest';

import { isRecord } from '../isRecord.ts';

describe(isRecord, () => {
  it('accepts a plain object', () => {
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it.each([null, [], 'text', 1, undefined])('rejects %j', (value) => {
    expect(isRecord(value)).toBe(false);
  });
});
