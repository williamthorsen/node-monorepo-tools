import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

import { loadPreset } from '../presets.ts';

describe(loadPreset, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  it('throws when the preset file does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    expect(() => loadPreset('nonexistent')).toThrow(/Unknown preset "nonexistent"/);
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
    mockReadFileSync.mockReturnValue('- name: bug\n  color: d73a4a\n');

    expect(() => loadPreset('bad')).toThrow(/invalid fields/);
  });

  it('returns correctly parsed labels for valid YAML', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      '- name: bug\n  color: d73a4a\n  description: "Something isn\'t working"\n- name: feature\n  color: 0075ca\n  description: New feature\n',
    );

    const result = loadPreset('common');

    expect(result).toEqual([
      { name: 'bug', color: 'd73a4a', description: "Something isn't working" },
      { name: 'feature', color: '0075ca', description: 'New feature' },
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
