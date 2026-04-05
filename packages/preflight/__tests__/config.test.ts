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

import { loadPreflightCollection } from '../src/config.ts';

const COLLECTION_PATH = '.preflight/collections/default.ts';

describe(loadPreflightCollection, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockJitiImport.mockReset();
  });

  it('throws when the collection file does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    await expect(loadPreflightCollection('missing/collection.ts')).rejects.toThrow('Preflight collection not found');
  });

  it('throws with a preflight init hint when a convention-path collection is missing', async () => {
    mockExistsSync.mockReturnValue(false);

    await expect(loadPreflightCollection('.preflight/collections/default.ts')).rejects.toThrow(
      'Collection "default" not found. Run \'preflight init\' to create one.',
    );
  });

  it('shows the user-provided path in file-not-found errors', async () => {
    mockExistsSync.mockReturnValue(false);

    await expect(loadPreflightCollection('custom/path.ts')).rejects.toThrow(
      'Preflight collection not found: custom/path.ts',
    );
  });

  it('includes the path in file-not-found errors for non-convention paths', async () => {
    mockExistsSync.mockReturnValue(false);

    await expect(loadPreflightCollection('some/other.ts')).rejects.toThrow(
      'Preflight collection not found: some/other.ts',
    );
  });

  it.each(['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'])(
    'catches %s errors with an actionable message',
    async (code) => {
      mockExistsSync.mockReturnValue(true);
      const moduleError = Object.assign(new Error("Cannot find package '@williamthorsen/preflight'"), { code });
      mockJitiImport.mockRejectedValue(moduleError);

      await expect(loadPreflightCollection(COLLECTION_PATH)).rejects.toThrow(
        /Cannot resolve '@williamthorsen\/preflight'.*installed as a project dependency.*'preflight compile'/,
      );
    },
  );

  it('falls back to "unknown module" when the error message does not match the expected pattern', async () => {
    mockExistsSync.mockReturnValue(true);
    const moduleError = Object.assign(new Error('Module load failed'), { code: 'MODULE_NOT_FOUND' });
    mockJitiImport.mockRejectedValue(moduleError);

    await expect(loadPreflightCollection(COLLECTION_PATH)).rejects.toThrow(
      /Cannot resolve 'unknown module'.*installed as a project dependency/,
    );
  });

  it('re-throws non-module-resolution errors from jiti', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockRejectedValue(new SyntaxError('Unexpected token'));

    await expect(loadPreflightCollection(COLLECTION_PATH)).rejects.toThrow(SyntaxError);
  });

  it('resolves the collection path against process.cwd()', async () => {
    const expectedPath = path.resolve(process.cwd(), COLLECTION_PATH);
    const validChecklists = [{ name: 'test', checks: [{ name: 'a', check: () => true }] }];
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ checklists: validChecklists });

    await loadPreflightCollection(COLLECTION_PATH);

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

    await expect(loadPreflightCollection(COLLECTION_PATH)).rejects.toThrow(
      'Collection file must export an object, got string',
    );
  });

  it('throws when no checklists export exists', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ unrelated: true });

    await expect(loadPreflightCollection(COLLECTION_PATH)).rejects.toThrow('Collection file must export checklists');
  });

  it('loads a collection from a default export', async () => {
    const validChecklists = [{ name: 'test', checks: [{ name: 'a', check: () => true }] }];
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ default: { checklists: validChecklists } });

    const collection = await loadPreflightCollection(COLLECTION_PATH);

    expect(collection.checklists).toHaveLength(1);
    expect(collection.checklists[0]?.name).toBe('test');
  });

  it('loads a collection from a default export with fixLocation', async () => {
    const validChecklists = [{ name: 'test', checks: [{ name: 'a', check: () => true }] }];
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ default: { checklists: validChecklists, fixLocation: 'inline' } });

    const collection = await loadPreflightCollection(COLLECTION_PATH);

    expect(collection.fixLocation).toBe('inline');
  });

  it('returns a valid collection with flat checklists', async () => {
    const validChecklists = [{ name: 'test', checks: [{ name: 'a', check: () => true }] }];
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ checklists: validChecklists });

    const collection = await loadPreflightCollection(COLLECTION_PATH);

    expect(collection.checklists).toHaveLength(1);
    expect(collection.checklists[0]?.name).toBe('test');
  });

  it('carries through fixLocation when present', async () => {
    const validChecklists = [{ name: 'test', checks: [{ name: 'a', check: () => true }] }];
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ checklists: validChecklists, fixLocation: 'inline' });

    const collection = await loadPreflightCollection(COLLECTION_PATH);

    expect(collection.fixLocation).toBe('inline');
  });

  it('omits fixLocation when the module does not export it', async () => {
    const validChecklists = [{ name: 'test', checks: [{ name: 'a', check: () => true }] }];
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ checklists: validChecklists });

    const collection = await loadPreflightCollection(COLLECTION_PATH);

    expect(collection.fixLocation).toBeUndefined();
  });
});
