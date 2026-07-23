import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RepoLabelsConfig } from '../../types.ts';
import type { LabelDefinition } from '../types.ts';

const mockLoadPreset = vi.hoisted(() => vi.fn());

vi.mock(import('../presets.ts'), () => ({
  loadPreset: mockLoadPreset,
}));

import { resolveLabels } from '../resolveLabels.ts';

const bugLabel: LabelDefinition = { name: 'bug', color: 'd73a4a', description: "Something isn't working" };
const featureLabel: LabelDefinition = { name: 'feature', color: '0075ca', description: 'New feature' };
const docsLabel: LabelDefinition = { name: 'documentation', color: 'a2eeef', description: 'Docs' };

describe(resolveLabels, () => {
  afterEach(() => {
    mockLoadPreset.mockReset();
  });

  it('returns an empty array for an empty config', () => {
    const config: RepoLabelsConfig = {};
    const result = resolveLabels(config);
    expect(result).toStrictEqual([]);
  });

  it('loads preset labels and returns them sorted alphabetically', () => {
    mockLoadPreset.mockReturnValue([featureLabel, bugLabel]);

    const config: RepoLabelsConfig = { extends: ['common'] };
    const result = resolveLabels(config);

    expect(mockLoadPreset).toHaveBeenCalledWith('common');
    expect(result).toStrictEqual([bugLabel, featureLabel]);
  });

  it('adds labels from the labels record to preset labels', () => {
    mockLoadPreset.mockReturnValue([featureLabel]);

    const config: RepoLabelsConfig = {
      extends: ['common'],
      labels: { [docsLabel.name]: { color: docsLabel.color, description: docsLabel.description } },
    };
    const result = resolveLabels(config);

    expect(result).toStrictEqual([docsLabel, featureLabel]);
  });

  it('returns only local labels when extends is absent', () => {
    const config: RepoLabelsConfig = {
      labels: {
        [featureLabel.name]: { color: featureLabel.color, description: featureLabel.description },
        [bugLabel.name]: { color: bugLabel.color, description: bugLabel.description },
      },
    };
    const result = resolveLabels(config);

    expect(result).toStrictEqual([bugLabel, featureLabel]);
  });

  it('resolves a name shared by two presets to the later preset (last writer wins)', () => {
    const recoloredBug: LabelDefinition = { ...bugLabel, color: 'ff0000' };
    mockLoadPreset.mockImplementation((name: string) => {
      if (name === 'preset-a') return [bugLabel, featureLabel];
      if (name === 'preset-b') return [recoloredBug];
      return [];
    });

    const config: RepoLabelsConfig = { extends: ['preset-a', 'preset-b'] };
    const result = resolveLabels(config);

    expect(result).toStrictEqual([recoloredBug, featureLabel]);
  });

  it('replaces a preset label with a local entry of the same name', () => {
    mockLoadPreset.mockReturnValue([bugLabel, featureLabel]);

    const config: RepoLabelsConfig = {
      extends: ['common'],
      labels: { bug: { color: 'ff0000', description: 'Custom bug' } },
    };
    const result = resolveLabels(config);

    expect(result).toStrictEqual([{ name: 'bug', color: 'ff0000', description: 'Custom bug' }, featureLabel]);
  });

  it('removes a preset label when the local entry is null', () => {
    mockLoadPreset.mockReturnValue([bugLabel, featureLabel]);

    const config: RepoLabelsConfig = {
      extends: ['common'],
      labels: { bug: null },
    };
    const result = resolveLabels(config);

    expect(result).toStrictEqual([featureLabel]);
  });

  it('throws on a null entry naming a label no preset defines', () => {
    mockLoadPreset.mockReturnValue([featureLabel]);

    const config: RepoLabelsConfig = {
      extends: ['common'],
      labels: { bug: null },
    };

    expect(() => resolveLabels(config)).toThrow(/Label 'bug' is set to null/);
  });

  it('produces identical output for the same config (idempotent)', () => {
    mockLoadPreset.mockReturnValue([featureLabel, bugLabel]);

    const config: RepoLabelsConfig = {
      extends: ['common'],
      labels: { [docsLabel.name]: { color: docsLabel.color, description: docsLabel.description } },
    };

    const result1 = resolveLabels(config);
    const result2 = resolveLabels(config);

    expect(result1).toStrictEqual(result2);
  });
});
