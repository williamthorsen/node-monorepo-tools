import { describe, expect, it } from 'vitest';

import type { Taxonomy } from '../types.ts';
import { validate } from '../validate.ts';

const TAXONOMY: Taxonomy = {
  tiers: ['public', 'internal', 'process'],
  types: [
    { breakingPolicy: 'optional', key: 'feat', tier: 'public' },
    { breakingPolicy: 'forbidden', key: 'refactor', tier: 'internal' },
    { key: 'tests', tier: 'internal' },
  ],
};

describe(validate, () => {
  it('reports a refactor with the marker forbidden by its policy', () => {
    expect(validate({ breaking: true, type: 'refactor' }, TAXONOMY)).toStrictEqual({
      policy: 'forbidden',
      type: 'refactor',
    });
  });

  it('leaves the record untouched rather than normalizing the violation away', () => {
    const record = { breaking: true, title: 'Restructure the guard', type: 'refactor' };
    validate(record, TAXONOMY);

    expect(record).toStrictEqual({ breaking: true, title: 'Restructure the guard', type: 'refactor' });
  });

  it('accepts a feat either way, its policy leaving the marker optional', () => {
    expect(validate({ type: 'feat' }, TAXONOMY)).toBeUndefined();
    expect(validate({ breaking: true, type: 'feat' }, TAXONOMY)).toBeUndefined();
  });

  it('treats a type declaring no policy as optional', () => {
    expect(validate({ breaking: true, type: 'tests' }, TAXONOMY)).toBeUndefined();
  });

  it('reports nothing for a type that the taxonomy does not declare', () => {
    expect(validate({ breaking: true, type: 'invented' }, TAXONOMY)).toBeUndefined();
  });
});
