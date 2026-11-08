import { describe, expect, it } from 'vitest';

import { compactRecord } from '../compactRecord.ts';

describe(compactRecord, () => {
  it('drops undefined properties and keeps falsy ones', () => {
    expect(compactRecord<{ a: string; b: number; c: boolean }>({ a: undefined, b: 0, c: false })).toStrictEqual({
      b: 0,
      c: false,
    });
  });

  it('returns undefined when every property is undefined', () => {
    expect(compactRecord<{ a: string }>({ a: undefined })).toBeUndefined();
    expect(compactRecord({})).toBeUndefined();
  });
});
