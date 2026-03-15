import { describe, expect, it } from 'vitest';

import { isRecord } from '../typeGuards.ts';

describe(isRecord, () => {
  it.each([
    ['plain object', {}, true],
    ['object with properties', { a: 1, b: 'two' }, true],
    ['null', null, false],
    ['undefined', undefined, false],
    ['array', [1, 2, 3], false],
    ['empty array', [], false],
    ['string', 'hello', false],
    ['number', 42, false],
    ['boolean', true, false],
  ])('returns %s for %s', (_label, value, expected) => {
    expect(isRecord(value)).toBe(expected);
  });

  it('returns true for Object.create(null)', () => {
    // Object.create(null) produces a prototype-less object, tested separately
    // to avoid a type assertion in the parameterized array.
    const nullProto: unknown = Object.create(null);
    expect(isRecord(nullProto)).toBe(true);
  });
});
