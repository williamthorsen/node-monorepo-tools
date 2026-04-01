import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReaddirSync = vi.hoisted(() => vi.fn());
const mockJitiImport = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  readdirSync: mockReaddirSync,
}));

vi.mock('jiti', () => ({
  createJiti: () => ({ import: mockJitiImport }),
}));

import { discoverInternalCollections } from '../src/discoverInternalCollections.ts';

describe(discoverInternalCollections, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockReaddirSync.mockReset();
    mockJitiImport.mockReset();
  });

  it('throws when the directory does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    await expect(discoverInternalCollections('.config/preflight/collections')).rejects.toThrow(
      'Collections directory not found',
    );
  });

  it('throws when the directory contains no .ts files', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['readme.md', 'data.json']);

    await expect(discoverInternalCollections('.config/preflight/collections')).rejects.toThrow(
      'No .ts collection files found',
    );
  });

  it('returns all valid collections from a directory', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['a.ts', 'b.ts']);
    mockJitiImport
      .mockResolvedValueOnce({
        checklists: [{ name: 'alpha', checks: [{ name: 'c1', check: () => true }] }],
      })
      .mockResolvedValueOnce({
        checklists: [{ name: 'beta', checks: [{ name: 'c2', check: () => true }] }],
      });

    const collections = await discoverInternalCollections('.config/preflight/collections');

    expect(collections).toHaveLength(2);
    expect(collections[0]?.checklists[0]?.name).toBe('alpha');
    expect(collections[1]?.checklists[0]?.name).toBe('beta');
  });

  it('returns collections from default-export modules', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['a.ts']);
    mockJitiImport.mockResolvedValueOnce({
      default: { checklists: [{ name: 'alpha', checks: [{ name: 'c1', check: () => true }] }] },
    });

    const collections = await discoverInternalCollections('.config/preflight/collections');

    expect(collections).toHaveLength(1);
    expect(collections[0]?.checklists[0]?.name).toBe('alpha');
  });

  it('throws a file-specific error for invalid collection files', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['bad.ts']);
    mockJitiImport.mockResolvedValue({ unrelated: true });

    await expect(discoverInternalCollections('.config/preflight/collections')).rejects.toThrow('bad.ts:');
  });

  it('throws a file-specific error when collection has invalid checklists', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['bad.ts']);
    mockJitiImport.mockResolvedValue({ checklists: [{ name: '' }] });

    await expect(discoverInternalCollections('.config/preflight/collections')).rejects.toThrow('bad.ts:');
  });

  it('ignores non-.ts files', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['collection.ts', 'readme.md', 'data.js']);
    mockJitiImport.mockResolvedValue({
      checklists: [{ name: 'test', checks: [{ name: 'c1', check: () => true }] }],
    });

    const collections = await discoverInternalCollections('.config/preflight/collections');

    expect(collections).toHaveLength(1);
    expect(mockJitiImport).toHaveBeenCalledTimes(1);
  });

  it('sorts files alphabetically for deterministic order', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['z.ts', 'a.ts']);
    mockJitiImport
      .mockResolvedValueOnce({
        checklists: [{ name: 'alpha', checks: [{ name: 'c1', check: () => true }] }],
      })
      .mockResolvedValueOnce({
        checklists: [{ name: 'zeta', checks: [{ name: 'c2', check: () => true }] }],
      });

    const collections = await discoverInternalCollections('.config/preflight/collections');

    expect(collections[0]?.checklists[0]?.name).toBe('alpha');
    expect(collections[1]?.checklists[0]?.name).toBe('zeta');
  });
});
