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
    const validConfig = {
      checklists: [{ name: 'test', checks: [{ name: 'a', check: () => true }] }],
    };
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ default: validConfig });

    await loadPreflightConfig();

    expect(mockExistsSync).toHaveBeenCalledWith(expectedPath);
  });

  it('uses a custom config path when provided', async () => {
    const customPath = 'custom/config.ts';
    const expectedPath = path.resolve(process.cwd(), customPath);
    const validConfig = {
      checklists: [{ name: 'test', checks: [{ name: 'a', check: () => true }] }],
    };
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ default: validConfig });

    await loadPreflightConfig(customPath);

    expect(mockExistsSync).toHaveBeenCalledWith(expectedPath);
  });

  it('throws when jiti returns a non-object', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue('not-an-object');

    await expect(loadPreflightConfig()).rejects.toThrow('Config file must export an object, got string');
  });

  it('throws when no default or config export exists', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ unrelated: true });

    await expect(loadPreflightConfig()).rejects.toThrow('must have a default export or a named `config` export');
  });

  it('throws when checklists is missing', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ default: {} });

    await expect(loadPreflightConfig()).rejects.toThrow("must have a 'checklists' array");
  });

  it('throws when a checklist has neither checks nor groups', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ default: { checklists: [{ name: 'bad' }] } });

    await expect(loadPreflightConfig()).rejects.toThrow("must have either 'checks' or 'groups'");
  });

  it('throws when a checklist has both checks and groups', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({
      default: { checklists: [{ name: 'bad', checks: [], groups: [] }] },
    });

    await expect(loadPreflightConfig()).rejects.toThrow("cannot have both 'checks' and 'groups'");
  });

  it('returns a valid config with flat checklists', async () => {
    const validConfig = {
      checklists: [{ name: 'test', checks: [{ name: 'a', check: () => true }] }],
    };
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ default: validConfig });

    const config = await loadPreflightConfig();

    expect(config.checklists).toHaveLength(1);
    expect(config.checklists[0]?.name).toBe('test');
  });

  it('returns a valid config via named config export', async () => {
    const validConfig = {
      checklists: [{ name: 'test', checks: [{ name: 'a', check: () => true }] }],
    };
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ config: validConfig });

    const config = await loadPreflightConfig();

    expect(config.checklists).toHaveLength(1);
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
