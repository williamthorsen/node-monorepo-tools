import { CANONICAL_TAXONOMY } from '@williamthorsen/change-grammar';
import { describe, expect, it } from 'vitest';

import { deriveTypeLabels, TYPE_LABEL_PRESENTATION } from '../typeLabels.ts';

describe(deriveTypeLabels, () => {
  it('names one label per work type by its tracker label, in taxonomy order', () => {
    const names = deriveTypeLabels(CANONICAL_TAXONOMY).map((label) => label.name);

    expect(names).toStrictEqual(CANONICAL_TAXONOMY.types.map((entry) => entry.trackerLabel));
  });

  it('takes the color and description from the presentation row of the type', () => {
    const [label] = deriveTypeLabels({ types: [{ key: 'drop', tier: 'public', trackerLabel: 'removal' }] });

    expect(label).toStrictEqual({ name: 'removal', ...TYPE_LABEL_PRESENTATION['drop'] });
  });

  it.each([
    ['public', '0075ca'],
    ['internal', '1d76db'],
    ['process', 'edc287'],
    ['unranked', 'ededed'],
  ])('gives a type without a presentation row in the %s tier color %s and omits the description', (tier, color) => {
    const labels = deriveTypeLabels({ types: [{ key: 'novel', tier, trackerLabel: 'novelty' }] });

    expect(labels).toStrictEqual([{ name: 'novelty', color }]);
  });
});

describe('TYPE_LABEL_PRESENTATION', () => {
  const taxonomyKeys = CANONICAL_TAXONOMY.types.map((entry) => entry.key);

  it.each(Object.keys(TYPE_LABEL_PRESENTATION))('row "%s" names a work type in the taxonomy', (key) => {
    expect(taxonomyKeys).toContain(key);
  });

  it.each(Object.entries(TYPE_LABEL_PRESENTATION))(
    'row "%s" has a description within the 100 characters that GitHub allows',
    (_key, { description }) => {
      expect(description.length).toBeLessThanOrEqual(100);
    },
  );
});
