import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LabelDefinition, SyncLabelsConfig } from '../types.ts';

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

  it('returns an empty array when config has no presets and no custom labels', () => {
    const config: SyncLabelsConfig = {};
    const result = resolveLabels(config);
    expect(result).toEqual([]);
  });

  it('loads preset labels and returns them sorted alphabetically', () => {
    mockLoadPreset.mockReturnValue([featureLabel, bugLabel]);

    const config: SyncLabelsConfig = { presets: ['common'] };
    const result = resolveLabels(config);

    expect(mockLoadPreset).toHaveBeenCalledWith('common');
    expect(result).toEqual([bugLabel, featureLabel]);
  });

  it('merges preset and custom labels sorted alphabetically', () => {
    mockLoadPreset.mockReturnValue([featureLabel]);

    const config: SyncLabelsConfig = {
      presets: ['common'],
      labels: [docsLabel],
    };
    const result = resolveLabels(config);

    expect(result).toEqual([docsLabel, featureLabel]);
  });

  it('returns only custom labels when no presets are specified', () => {
    const config: SyncLabelsConfig = {
      labels: [featureLabel, bugLabel],
    };
    const result = resolveLabels(config);

    expect(result).toEqual([bugLabel, featureLabel]);
  });

  it('loads multiple presets in order', () => {
    mockLoadPreset.mockImplementation((name: string) => {
      if (name === 'common') return [bugLabel];
      if (name === 'extra') return [docsLabel];
      return [];
    });

    const config: SyncLabelsConfig = { presets: ['common', 'extra'] };
    const result = resolveLabels(config);

    expect(mockLoadPreset).toHaveBeenCalledWith('common');
    expect(mockLoadPreset).toHaveBeenCalledWith('extra');
    expect(result).toEqual([bugLabel, docsLabel]);
  });

  it('throws when a custom label name collides with a preset label name', () => {
    mockLoadPreset.mockReturnValue([bugLabel]);

    const config: SyncLabelsConfig = {
      presets: ['common'],
      labels: [{ name: 'bug', color: 'ff0000', description: 'Custom bug' }],
    };

    expect(() => resolveLabels(config)).toThrow(/Label name collision/);
    expect(() => resolveLabels(config)).toThrow(/bug/);
  });

  it('produces identical output for the same config (idempotent)', () => {
    mockLoadPreset.mockReturnValue([featureLabel, bugLabel]);

    const config: SyncLabelsConfig = {
      presets: ['common'],
      labels: [docsLabel],
    };

    const result1 = resolveLabels(config);
    const result2 = resolveLabels(config);

    expect(result1).toEqual(result2);
  });
});
