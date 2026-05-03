import { describe, expect, it } from 'vitest';

import { composeHeader, DEFAULT_CHANGELOG_JSON_CONFIG, DEFAULT_WORK_TYPES, WORK_TYPES_DATA } from '../defaults.ts';

const workTypesData = WORK_TYPES_DATA;

describe('DEFAULT_WORK_TYPES derivation from work-types.json', () => {
  it('contains every entry from work-types.json under its canonical key', () => {
    for (const entry of workTypesData.types) {
      expect(DEFAULT_WORK_TYPES, `key "${entry.key}" missing from DEFAULT_WORK_TYPES`).toHaveProperty(entry.key);
    }
  });

  it('uses `${emoji} ${label}` (single space) as the composed header for every entry', () => {
    for (const entry of workTypesData.types) {
      const config = DEFAULT_WORK_TYPES[entry.key];
      expect(config?.header).toBe(`${entry.emoji} ${entry.label}`);
    }
  });

  it('exposes a `composeHeader` helper that produces the same composition rule', () => {
    expect(composeHeader({ emoji: '🎉', label: 'Features' })).toBe('🎉 Features');
  });

  it('preserves the canonical declaration order (tier order, then row order within tier)', () => {
    const expectedKeys = workTypesData.types.map((entry) => entry.key);
    const actualKeys = Object.keys(DEFAULT_WORK_TYPES);
    expect(actualKeys).toStrictEqual(expectedKeys);
  });

  it('places `fmt` last for parser-recognition / bump-determination purposes', () => {
    const keys = Object.keys(DEFAULT_WORK_TYPES);
    expect(keys.at(-1)).toBe('fmt');
  });

  it('wires every alias from the JSON onto its canonical entry', () => {
    for (const entry of workTypesData.types) {
      const config = DEFAULT_WORK_TYPES[entry.key];
      if (entry.aliases.length === 0) {
        expect(config?.aliases).toBeUndefined();
        continue;
      }
      expect(config?.aliases).toStrictEqual(entry.aliases);
    }
  });

  it('exposes `utility` as an alias of `internal`', () => {
    expect(DEFAULT_WORK_TYPES.internal?.aliases).toContain('utility');
  });
});

describe('DEFAULT_CHANGELOG_JSON_CONFIG.devOnlySections derivation', () => {
  it('contains exactly Internal and Process entries (excluding excludedFromChangelog), in canonical order', () => {
    const expected = workTypesData.types
      .filter(
        (entry) => (entry.tier === 'Internal' || entry.tier === 'Process') && entry.excludedFromChangelog !== true,
      )
      .map((entry) => composeHeader(entry));
    expect(DEFAULT_CHANGELOG_JSON_CONFIG.devOnlySections).toStrictEqual(expected);
  });

  it('excludes `fmt` (Process, excludedFromChangelog) from devOnlySections', () => {
    const fmtHeader = composeHeader({ emoji: '🎨', label: 'Formatting' });
    expect(DEFAULT_CHANGELOG_JSON_CONFIG.devOnlySections).not.toContain(fmtHeader);
  });

  it('includes `📚 Documentation` (docs reclassified to dev-only Process tier)', () => {
    expect(DEFAULT_CHANGELOG_JSON_CONFIG.devOnlySections).toContain('📚 Documentation');
  });

  it('does NOT contain Public-tier entries (Features, Bug fixes, Removed, etc.)', () => {
    expect(DEFAULT_CHANGELOG_JSON_CONFIG.devOnlySections).not.toContain('🎉 Features');
    expect(DEFAULT_CHANGELOG_JSON_CONFIG.devOnlySections).not.toContain('🐛 Bug fixes');
    expect(DEFAULT_CHANGELOG_JSON_CONFIG.devOnlySections).not.toContain('🪦 Removed');
  });
});
