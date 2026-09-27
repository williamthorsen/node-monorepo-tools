import { CANONICAL_TAXONOMY } from '@williamthorsen/change-grammar';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockFindPackageRoot = vi.hoisted(() => vi.fn().mockReturnValue('/fake/package'));
const mockDeriveTypeLabels = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

vi.mock(import('@williamthorsen/nmr-core'), () => ({
  findPackageRoot: mockFindPackageRoot,
}));

vi.mock(import('../typeLabels.ts'), async (importOriginal) => {
  const original = await importOriginal();
  mockDeriveTypeLabels.mockImplementation(original.deriveTypeLabels);
  return { ...original, deriveTypeLabels: mockDeriveTypeLabels };
});

import { hashPreset, loadPreset } from '../presets.ts';
import { deriveTypeLabels } from '../typeLabels.ts';

describe(hashPreset, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  it('changes when the type labels change though the preset file does not', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('- name: bug\n  color: d73a4a\n');
    const before = hashPreset('common');

    mockDeriveTypeLabels.mockReturnValueOnce([{ name: 'novelty', color: 'ededed' }]);

    expect(hashPreset('common')).not.toBe(before);
  });

  it('throws when the preset file does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    expect(() => hashPreset('nonexistent')).toThrow(/Unknown preset "nonexistent"/);
  });
});

describe(loadPreset, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  it('throws when the preset file does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    expect(() => loadPreset('nonexistent')).toThrow(/Unknown preset "nonexistent"/);
  });

  it('preserves the underlying error as the cause when the preset file cannot be read', () => {
    const underlying = new Error('EACCES: permission denied');
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw underlying;
    });

    expect(() => loadPreset('bad')).toThrow(expect.objectContaining({ cause: underlying }));
  });

  it('throws when YAML content is not an array', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('key: value\n');

    expect(() => loadPreset('bad')).toThrow(/must be a YAML array/);
  });

  it('throws when an entry is not an object', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('- not-an-object\n');

    expect(() => loadPreset('bad')).toThrow(/invalid label entry/);
  });

  it('throws when an entry has a non-string field', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('- name: 123\n  color: abc\n  description: desc\n');

    expect(() => loadPreset('bad')).toThrow(/invalid fields/);
  });

  it('throws when an entry is missing a required field', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('- name: bug\n  description: Something broken\n');

    expect(() => loadPreset('bad')).toThrow(/invalid fields/);
  });

  it('throws when an entry has a non-string description', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('- name: bug\n  color: d73a4a\n  description: 123\n');

    expect(() => loadPreset('bad')).toThrow(/invalid fields/);
  });

  it('omits the description key for an entry that declares none', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('- name: scope:nmr\n  color: 00ff96\n');

    expect(loadPreset('scopes')).toStrictEqual([{ name: 'scope:nmr', color: '00ff96' }]);
  });

  it('returns correctly parsed labels for valid YAML', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      '- name: bug\n  color: d73a4a\n  description: "Something isn\'t working"\n- name: feature\n  color: 0075ca\n  description: New feature\n',
    );

    const result = loadPreset('custom');

    expect(result).toStrictEqual([
      { name: 'bug', color: 'd73a4a', description: "Something isn't working" },
      { name: 'feature', color: '0075ca', description: 'New feature' },
    ]);
  });

  it('defines the label of every work type ahead of the file labels in the common preset', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('- name: bug\n  color: d73a4a\n');

    expect(loadPreset('common')).toStrictEqual([
      ...deriveTypeLabels(CANONICAL_TAXONOMY),
      { name: 'bug', color: 'd73a4a' },
    ]);
  });

  it('throws when readFileSync fails', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('EACCES');
    });

    expect(() => loadPreset('bad')).toThrow(/Failed to read preset "bad"/);
  });
});
