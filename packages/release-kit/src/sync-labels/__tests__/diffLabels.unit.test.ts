import { describe, expect, it } from 'vitest';

import { diffLabels, hasLabelDifferences } from '../diffLabels.ts';
import type { LabelDefinition } from '../types.ts';

const bugLabel: LabelDefinition = { name: 'bug', color: 'd73a4a', description: '' };
const featureLabel: LabelDefinition = { name: 'feature', color: '0075ca', description: 'New feature' };

describe(diffLabels, () => {
  it('returns an empty diff for identical lists', () => {
    const diff = diffLabels([bugLabel, featureLabel], [bugLabel, featureLabel]);

    expect(diff).toStrictEqual({ added: [], changed: [], removed: [], renamed: [] });
    expect(hasLabelDifferences(diff)).toBe(false);
  });

  it('ignores a difference in order', () => {
    const diff = diffLabels([bugLabel, featureLabel], [featureLabel, bugLabel]);

    expect(hasLabelDifferences(diff)).toBe(false);
  });

  it('reports added and removed labels', () => {
    const diff = diffLabels([bugLabel], [featureLabel]);

    expect(diff).toStrictEqual({ added: ['feature'], changed: [], removed: ['bug'], renamed: [] });
    expect(hasLabelDifferences(diff)).toBe(true);
  });

  it.each([
    ['color', { ...bugLabel, color: '000000' }],
    ['description', { ...bugLabel, description: 'Broken' }],
    ['aliases', { ...bugLabel, aliases: ['defect'] }],
    ['archived', { ...bugLabel, archived: true as const }],
  ])('reports a label whose %s differs as changed', (_property, nextLabel) => {
    const diff = diffLabels([bugLabel], [nextLabel]);

    expect(diff).toStrictEqual({ added: [], changed: ['bug'], removed: [], renamed: [] });
  });

  it('reports an added label that names a removed one in its aliases as a rename', () => {
    const previous: LabelDefinition[] = [{ name: 'priority:high', color: 'd93f0b', description: '' }];
    const next: LabelDefinition[] = [
      { name: 'urgency:high', color: 'd93f0b', description: '', aliases: ['priority:high'] },
    ];

    const diff = diffLabels(previous, next);

    expect(diff).toStrictEqual({
      added: [],
      changed: [],
      removed: [],
      renamed: [{ from: 'priority:high', to: 'urgency:high' }],
    });
  });

  it('reports an alias that names a label still present as an addition, not a rename', () => {
    const next: LabelDefinition[] = [bugLabel, { name: 'defect', color: 'd73a4a', description: '', aliases: ['bug'] }];

    const diff = diffLabels([bugLabel], next);

    expect(diff).toStrictEqual({ added: ['defect'], changed: [], removed: [], renamed: [] });
  });
});
