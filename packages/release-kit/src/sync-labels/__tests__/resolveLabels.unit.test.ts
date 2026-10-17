import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RepoLabelsConfig } from '../../configSchema.ts';
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

  it('resolves a later preset name that differs only in case to the later preset, keeping its spelling', () => {
    const recasedBug: LabelDefinition = { ...bugLabel, name: 'Bug' };
    mockLoadPreset.mockImplementation((name: string) => {
      if (name === 'preset-a') return [bugLabel, featureLabel];
      if (name === 'preset-b') return [recasedBug];
      return [];
    });

    const config: RepoLabelsConfig = { extends: ['preset-a', 'preset-b'] };
    const result = resolveLabels(config);

    expect(result).toStrictEqual([recasedBug, featureLabel]);
  });

  it('replaces a preset label with a local entry whose name differs only in case, keeping the local spelling', () => {
    mockLoadPreset.mockReturnValue([bugLabel, featureLabel]);

    const config: RepoLabelsConfig = {
      extends: ['common'],
      labels: { Bug: { color: 'ff0000' } },
    };
    const result = resolveLabels(config);

    expect(result).toStrictEqual([{ name: 'Bug', color: 'ff0000' }, featureLabel]);
  });

  it('throws on labels keys that differ only in case, naming each group', () => {
    const config: RepoLabelsConfig = {
      labels: {
        bug: { color: 'd73a4a' },
        Bug: { color: 'ff0000' },
        feature: { color: '0075ca' },
        FEATURE: { color: '0075ca' },
      },
    };

    expect(() => resolveLabels(config)).toThrow("'bug' and 'Bug'; 'feature' and 'FEATURE'");
  });

  it('throws on labels keys that differ only in case when one of them is null', () => {
    mockLoadPreset.mockReturnValue([bugLabel]);

    const config: RepoLabelsConfig = {
      extends: ['common'],
      labels: { bug: null, Bug: { color: 'ff0000' } },
    };

    expect(() => resolveLabels(config)).toThrow("'bug' and 'Bug'");
  });

  it('omits the description key for a local entry without a description', () => {
    const config: RepoLabelsConfig = { labels: { 'scope:nmr': { color: '00ff96' } } };

    const result = resolveLabels(config);

    expect(result).toStrictEqual([{ name: 'scope:nmr', color: '00ff96' }]);
  });

  it('carries the archived mark of a local entry', () => {
    const config: RepoLabelsConfig = { labels: { 'scope:basic': { color: '00ff96', archived: true } } };

    const result = resolveLabels(config);

    expect(result).toStrictEqual([{ name: 'scope:basic', color: '00ff96', archived: true }]);
  });

  it('carries the aliases of a local entry', () => {
    const config: RepoLabelsConfig = { labels: { 'scope:core': { color: '00ff96', aliases: ['scope:basic'] } } };

    const result = resolveLabels(config);

    expect(result).toStrictEqual([{ name: 'scope:core', color: '00ff96', aliases: ['scope:basic'] }]);
  });

  it('throws when an alias names its own label in another case', () => {
    const config: RepoLabelsConfig = { labels: { 'scope:core': { color: '00ff96', aliases: ['Scope:Core'] } } };

    expect(() => resolveLabels(config)).toThrow(
      "'scope:core' declares alias 'Scope:Core', which names the label 'scope:core'",
    );
  });

  it('throws when an alias names another declared label', () => {
    const config: RepoLabelsConfig = {
      labels: {
        'scope:core': { color: '00ff96', aliases: ['scope:basic'] },
        'scope:basic': { color: '00ff96' },
      },
    };

    expect(() => resolveLabels(config)).toThrow(
      "'scope:core' declares alias 'scope:basic', which names the label 'scope:basic'",
    );
  });

  it('throws when an alias names a preset label', () => {
    mockLoadPreset.mockReturnValue([bugLabel]);

    const config: RepoLabelsConfig = {
      extends: ['common'],
      labels: { 'type:bug': { color: 'd73a4a', aliases: ['bug'] } },
    };

    expect(() => resolveLabels(config)).toThrow("'type:bug' declares alias 'bug', which names the label 'bug'");
  });

  it('throws when two labels declare the same alias', () => {
    const config: RepoLabelsConfig = {
      labels: {
        'scope:a': { color: '00ff96', aliases: ['scope:old'] },
        'scope:b': { color: '00ff96', aliases: ['Scope:Old'] },
      },
    };

    expect(() => resolveLabels(config)).toThrow("'scope:b' declares alias 'Scope:Old', which 'scope:a' also declares");
  });

  it('throws when one label declares an alias twice', () => {
    const config: RepoLabelsConfig = {
      labels: { 'scope:a': { color: '00ff96', aliases: ['scope:old', 'scope:old'] } },
    };

    expect(() => resolveLabels(config)).toThrow("'scope:a' declares alias 'scope:old', which 'scope:a' also declares");
  });

  it('reports every alias collision in one error', () => {
    const config: RepoLabelsConfig = {
      labels: {
        'scope:a': { color: '00ff96', aliases: ['scope:a'] },
        'scope:b': { color: '00ff96', aliases: ['scope:a'] },
      },
    };

    expect(() => resolveLabels(config)).toThrow(
      "'scope:a' declares alias 'scope:a', which names the label 'scope:a'; 'scope:b' declares alias 'scope:a', which names the label 'scope:a'",
    );
  });

  it('accepts an alias naming a preset label that a null entry removes', () => {
    mockLoadPreset.mockReturnValue([bugLabel]);

    const config: RepoLabelsConfig = {
      extends: ['common'],
      labels: { bug: null, 'type:bug': { color: 'd73a4a', aliases: ['bug'] } },
    };
    const result = resolveLabels(config);

    expect(result).toStrictEqual([{ name: 'type:bug', color: 'd73a4a', aliases: ['bug'] }]);
  });

  it('archives a preset label that a local entry replaces with the mark', () => {
    mockLoadPreset.mockReturnValue([bugLabel]);

    const config: RepoLabelsConfig = {
      extends: ['common'],
      labels: { bug: { color: 'd73a4a', archived: true } },
    };
    const result = resolveLabels(config);

    expect(result).toStrictEqual([{ name: 'bug', color: 'd73a4a', archived: true }]);
  });

  // A bare scope entry resolves to bare only because a color-only override drops the preset's description.
  it('drops a preset description when the replacing entry omits one', () => {
    mockLoadPreset.mockReturnValue([bugLabel]);

    const config: RepoLabelsConfig = {
      extends: ['common'],
      labels: { bug: { color: 'ff0000' } },
    };
    const result = resolveLabels(config);

    expect(result).toStrictEqual([{ name: 'bug', color: 'ff0000' }]);
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

  it('removes a preset label when a null entry names it in a different case', () => {
    mockLoadPreset.mockReturnValue([bugLabel, featureLabel]);

    const config: RepoLabelsConfig = {
      extends: ['common'],
      labels: { BUG: null },
    };
    const result = resolveLabels(config);

    expect(result).toStrictEqual([featureLabel]);
  });

  it('throws on a null entry naming a label that the presets do not define', () => {
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
