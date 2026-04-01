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
  CONFIG_FILE_PATH,
  defineChecklists,
  definePreflightCheckList,
  definePreflightConfig,
  defineStagedPreflightCheckList,
  loadPreflightConfig,
} from '../src/config.ts';

describe(loadPreflightConfig, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockJitiImport.mockReset();
  });

  it('throws when the config file does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    await expect(loadPreflightConfig()).rejects.toThrow('Preflight config not found');
  });

  it('resolves the default config path against process.cwd()', async () => {
    const expectedPath = path.resolve(process.cwd(), CONFIG_FILE_PATH);
    const validChecklists = [{ name: 'test', checks: [{ name: 'a', check: () => true }] }];
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ checklists: validChecklists });

    await loadPreflightConfig();

    expect(mockExistsSync).toHaveBeenCalledWith(expectedPath);
  });

  it('uses a custom config path when provided', async () => {
    const customPath = 'custom/config.ts';
    const expectedPath = path.resolve(process.cwd(), customPath);
    const validChecklists = [{ name: 'test', checks: [{ name: 'a', check: () => true }] }];
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ checklists: validChecklists });

    await loadPreflightConfig(customPath);

    expect(mockExistsSync).toHaveBeenCalledWith(expectedPath);
  });

  it('throws when jiti returns a non-object', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue('not-an-object');

    await expect(loadPreflightConfig()).rejects.toThrow('Config file must export an object, got string');
  });

  it('throws when no checklists export exists', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ unrelated: true });

    await expect(loadPreflightConfig()).rejects.toThrow('must export a named `checklists` export');
  });

  it('returns a valid config with flat checklists', async () => {
    const validChecklists = [{ name: 'test', checks: [{ name: 'a', check: () => true }] }];
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ checklists: validChecklists });

    const config = await loadPreflightConfig();

    expect(config.checklists).toHaveLength(1);
    expect(config.checklists[0]?.name).toBe('test');
  });

  it('carries through fixLocation when present', async () => {
    const validChecklists = [{ name: 'test', checks: [{ name: 'a', check: () => true }] }];
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ checklists: validChecklists, fixLocation: 'INLINE' });

    const config = await loadPreflightConfig();

    expect(config.fixLocation).toBe('INLINE');
  });

  it('omits fixLocation when the module does not export it', async () => {
    const validChecklists = [{ name: 'test', checks: [{ name: 'a', check: () => true }] }];
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ checklists: validChecklists });

    const config = await loadPreflightConfig();

    expect(config.fixLocation).toBeUndefined();
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
      checklists: [{ name: 'test', checks: [{ name: 'a', check: () => true }] }],
    };

    expect(definePreflightConfig(config)).toBe(config);
  });
});

describe(definePreflightCheckList, () => {
  it('returns its input unchanged', () => {
    const checklist = { name: 'test', checks: [{ name: 'a', check: () => true }] };

    expect(definePreflightCheckList(checklist)).toBe(checklist);
  });
});

describe(defineStagedPreflightCheckList, () => {
  it('returns its input unchanged', () => {
    const checklist = { name: 'test', groups: [[{ name: 'a', check: () => true }]] };

    expect(defineStagedPreflightCheckList(checklist)).toBe(checklist);
  });
});
