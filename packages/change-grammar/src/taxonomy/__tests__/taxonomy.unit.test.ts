import { describe, expect, it } from 'vitest';

import type { Taxonomy } from '../../record/types.ts';
import { validate } from '../../record/validate.ts';
import { compileTemplate } from '../../template/compile-template.ts';
import { parse } from '../../template/parse.ts';
import { TEMPLATE_CATALOGUE } from '../../template/templates.ts';
import { verify } from '../../template/verify.ts';
import { CANONICAL_TAXONOMY } from '../taxonomy.ts';

describe('CANONICAL_TAXONOMY', () => {
  it('serves as the engine taxonomy', () => {
    const taxonomy: Taxonomy = CANONICAL_TAXONOMY;

    for (const template of Object.values(TEMPLATE_CATALOGUE)) {
      expect(verify(template, taxonomy)).toStrictEqual([]);
    }
  });

  it('resolves aliases to their canonical keys', () => {
    const nodes = compileTemplate(TEMPLATE_CATALOGUE.conventionalCommits);

    expect(parse(nodes, 'bugfix(nmr): Repair the cache', CANONICAL_TAXONOMY)).toStrictEqual({
      scope: 'nmr',
      title: 'Repair the cache',
      type: 'fix',
    });
  });

  it('admits the breaking marker on drop and forbids it on deprecate', () => {
    expect(validate({ breaking: true, type: 'drop' }, CANONICAL_TAXONOMY)).toBeUndefined();
    expect(validate({ breaking: true, type: 'deprecate' }, CANONICAL_TAXONOMY)).toStrictEqual({
      policy: 'forbidden',
      type: 'deprecate',
    });
  });

  it('declares each key and tracker label once', () => {
    const keys = CANONICAL_TAXONOMY.types.map((entry) => entry.key);
    const trackerLabels = CANONICAL_TAXONOMY.types.map((entry) => entry.trackerLabel);

    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(trackerLabels).size).toBe(trackerLabels.length);
  });

  it('places every type in a declared tier', () => {
    for (const entry of CANONICAL_TAXONOMY.types) {
      expect(CANONICAL_TAXONOMY.tiers).toContain(entry.tier);
    }
  });
});
