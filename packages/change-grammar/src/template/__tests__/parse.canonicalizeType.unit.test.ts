import { describe, expect, it } from 'vitest';

import type { Taxonomy } from '../../record/types.ts';
import { canonicalizeType } from '../parse.ts';

const LOWERCASE_TAXONOMY: Taxonomy = {
  tiers: ['public'],
  types: [{ aliases: ['feature'], key: 'feat', tier: 'public' }],
};

const MIXED_CASE_TAXONOMY: Taxonomy = {
  tiers: ['public'],
  types: [{ aliases: ['Bugfix'], key: 'Fix', tier: 'public' }],
};

describe(canonicalizeType, () => {
  it('resolves a lowercase spelling to a key declared with an uppercase letter', () => {
    expect(canonicalizeType('fix', MIXED_CASE_TAXONOMY)).toBe('Fix');
  });

  it('resolves a lowercase spelling of an alias declared with an uppercase letter', () => {
    expect(canonicalizeType('bugfix', MIXED_CASE_TAXONOMY)).toBe('Fix');
  });

  it('resolves an uppercase spelling against lowercase declarations', () => {
    expect(canonicalizeType('FEATURE', LOWERCASE_TAXONOMY)).toBe('feat');
  });

  it('returns undefined for a spelling that the taxonomy does not declare', () => {
    expect(canonicalizeType('chore', LOWERCASE_TAXONOMY)).toBeUndefined();
  });
});
