import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockJitiImport = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
}));

vi.mock('jiti', () => ({
  createJiti: () => ({ import: mockJitiImport }),
}));

import { loadSyncLabelsConfig } from '../loadSyncLabelsConfig.ts';

describe(loadSyncLabelsConfig, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockJitiImport.mockReset();
  });

  it('returns undefined when config file does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    const result = await loadSyncLabelsConfig();

    expect(result).toBeUndefined();
  });

  it('throws when imported value is not an object', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue('not-an-object');

    await expect(loadSyncLabelsConfig()).rejects.toThrow(/must export an object/);
  });

  it('throws when imported value is an array', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue([1, 2, 3]);

    await expect(loadSyncLabelsConfig()).rejects.toThrow(/must export an object.*array/);
  });

  it('throws when neither default nor config export exists', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ something: 'else' });

    await expect(loadSyncLabelsConfig()).rejects.toThrow(/must have a default export or a named `config` export/);
  });

  it('throws when presets is not an array of strings', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ default: { presets: 'common' } });

    await expect(loadSyncLabelsConfig()).rejects.toThrow(/`presets` must be an array of strings/);
  });

  it('throws when presets contains a non-string element', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ default: { presets: ['common', 42] } });

    await expect(loadSyncLabelsConfig()).rejects.toThrow(/`presets` must be an array of strings/);
  });

  it('throws when labels is not an array', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ default: { labels: 'not-array' } });

    await expect(loadSyncLabelsConfig()).rejects.toThrow(/`labels` must be an array/);
  });

  it('throws when a label entry is not an object', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ default: { labels: ['not-object'] } });

    await expect(loadSyncLabelsConfig()).rejects.toThrow(/Each label must be an object/);
  });

  it('throws when a label has a non-string field', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({
      default: { labels: [{ name: 'bug', color: 123, description: 'desc' }] },
    });

    await expect(loadSyncLabelsConfig()).rejects.toThrow(/must have string `name`, `color`, and `description`/);
  });

  it('returns valid config with default export', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({
      default: {
        presets: ['common'],
        labels: [{ name: 'custom', color: 'ff0000', description: 'Custom label' }],
      },
    });

    const result = await loadSyncLabelsConfig();

    expect(result).toStrictEqual({
      presets: ['common'],
      labels: [{ name: 'custom', color: 'ff0000', description: 'Custom label' }],
    });
  });

  it('returns valid config with named config export', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({
      config: {
        presets: ['common'],
      },
    });

    const result = await loadSyncLabelsConfig();

    expect(result).toStrictEqual({ presets: ['common'] });
  });

  it('returns valid config with no presets or labels', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ default: {} });

    const result = await loadSyncLabelsConfig();

    expect(result).toStrictEqual({});
  });
});
