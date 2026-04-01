import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockJitiImport = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
}));

vi.mock('jiti', () => ({
  createJiti: () => ({ import: mockJitiImport }),
}));

import {
  COLLECTION_FILE_PATH,
  defineChecklists,
  definePreflightChecklist,
  definePreflightCollection,
  definePreflightConfig,
  definePreflightStagedChecklist,
  loadPreflightCollection,
} from '../src/config.ts';

describe(loadPreflightCollection, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockJitiImport.mockReset();
  });

  it('throws when the collection file does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    await expect(loadPreflightCollection()).rejects.toThrow('Preflight collection not found');
  });

  it('resolves the default collection path against process.cwd()', async () => {
    const expectedPath = path.resolve(process.cwd(), COLLECTION_FILE_PATH);
    const validChecklists = [{ name: 'test', checks: [{ name: 'a', check: () => true }] }];
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ checklists: validChecklists });

    await loadPreflightCollection();

    expect(mockExistsSync).toHaveBeenCalledWith(expectedPath);
  });

  it('uses a custom collection path when provided', async () => {
    const customPath = 'custom/config.ts';
    const expectedPath = path.resolve(process.cwd(), customPath);
    const validChecklists = [{ name: 'test', checks: [{ name: 'a', check: () => true }] }];
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ checklists: validChecklists });

    await loadPreflightCollection(customPath);

    expect(mockExistsSync).toHaveBeenCalledWith(expectedPath);
  });

  it('throws when jiti returns a non-object', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue('not-an-object');

    await expect(loadPreflightCollection()).rejects.toThrow('Collection file must export an object, got string');
  });

  it('throws when no checklists export exists', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ unrelated: true });

    await expect(loadPreflightCollection()).rejects.toThrow('Collection file must export checklists');
  });

  it('loads a collection from a default export', async () => {
    const validChecklists = [{ name: 'test', checks: [{ name: 'a', check: () => true }] }];
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ default: { checklists: validChecklists } });

    const collection = await loadPreflightCollection();

    expect(collection.checklists).toHaveLength(1);
    expect(collection.checklists[0]?.name).toBe('test');
  });

  it('loads a collection from a default export with fixLocation', async () => {
    const validChecklists = [{ name: 'test', checks: [{ name: 'a', check: () => true }] }];
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ default: { checklists: validChecklists, fixLocation: 'INLINE' } });

    const collection = await loadPreflightCollection();

    expect(collection.fixLocation).toBe('INLINE');
  });

  it('returns a valid collection with flat checklists', async () => {
    const validChecklists = [{ name: 'test', checks: [{ name: 'a', check: () => true }] }];
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ checklists: validChecklists });

    const collection = await loadPreflightCollection();

    expect(collection.checklists).toHaveLength(1);
    expect(collection.checklists[0]?.name).toBe('test');
  });

  it('carries through fixLocation when present', async () => {
    const validChecklists = [{ name: 'test', checks: [{ name: 'a', check: () => true }] }];
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ checklists: validChecklists, fixLocation: 'INLINE' });

    const collection = await loadPreflightCollection();

    expect(collection.fixLocation).toBe('INLINE');
  });

  it('omits fixLocation when the module does not export it', async () => {
    const validChecklists = [{ name: 'test', checks: [{ name: 'a', check: () => true }] }];
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ checklists: validChecklists });

    const collection = await loadPreflightCollection();

    expect(collection.fixLocation).toBeUndefined();
  });
});

describe(defineChecklists, () => {
  it('returns its input unchanged', () => {
    const checklists = [{ name: 'test', checks: [{ name: 'a', check: () => true }] }];

    expect(defineChecklists(checklists)).toBe(checklists);
  });
});

describe(definePreflightConfig, () => {
  it('returns its input unchanged', () => {
    const config = {
      compile: { srcDir: '.preflight/distribution', outDir: '.preflight/distribution' },
    };

    expect(definePreflightConfig(config)).toBe(config);
  });
});

describe(definePreflightCollection, () => {
  it('returns its input unchanged', () => {
    const collection = {
      checklists: [{ name: 'test', checks: [{ name: 'a', check: () => true }] }],
    };

    expect(definePreflightCollection(collection)).toBe(collection);
  });
});

describe(definePreflightChecklist, () => {
  it('returns its input unchanged', () => {
    const checklist = { name: 'test', checks: [{ name: 'a', check: () => true }] };

    expect(definePreflightChecklist(checklist)).toBe(checklist);
  });
});

describe(definePreflightStagedChecklist, () => {
  it('returns its input unchanged', () => {
    const checklist = { name: 'test', groups: [[{ name: 'a', check: () => true }]] };

    expect(definePreflightStagedChecklist(checklist)).toBe(checklist);
  });
});
