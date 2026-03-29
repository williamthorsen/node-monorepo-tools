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

import { DEFAULT_VERSION_PATTERNS, DEFAULT_WORK_TYPES } from '../defaults.ts';
import { CONFIG_FILE_PATH, loadConfig, mergeMonorepoConfig, mergeSinglePackageConfig } from '../loadConfig.ts';

describe(loadConfig, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockJitiImport.mockReset();
  });

  it('returns undefined when the config file does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    const result = await loadConfig();

    expect(result).toBeUndefined();
  });

  it('resolves the config path against process.cwd()', async () => {
    const expectedPath = path.resolve(process.cwd(), CONFIG_FILE_PATH);
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ default: {} });

    await loadConfig();

    expect(mockExistsSync).toHaveBeenCalledWith(expectedPath);
    expect(mockJitiImport).toHaveBeenCalledWith(expectedPath);
  });

  it('throws when jiti returns a non-object value', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue('not-an-object');

    await expect(loadConfig()).rejects.toThrow('Config file must export an object, got string');
  });

  it('throws when jiti returns an array', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue([1, 2, 3]);

    await expect(loadConfig()).rejects.toThrow('Config file must export an object, got array');
  });

  it('throws when the exported record has no default or config export', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ unrelated: true });

    await expect(loadConfig()).rejects.toThrow('must have a default export or a named `config` export');
  });

  it('returns the default export when present', async () => {
    const configObject = { workTypes: { perf: { header: 'Performance' } } };
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ default: configObject });

    const result = await loadConfig();

    expect(result).toBe(configObject);
  });

  it('returns the named config export when no default is present', async () => {
    const configObject = { formatCommand: 'pnpm run fmt' };
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ config: configObject });

    const result = await loadConfig();

    expect(result).toBe(configObject);
  });

  it('prefers the default export over the named config export', async () => {
    const defaultConfig = { formatCommand: 'default' };
    const namedConfig = { formatCommand: 'named' };
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ default: defaultConfig, config: namedConfig });

    const result = await loadConfig();

    expect(result).toBe(defaultConfig);
  });
});

describe(mergeMonorepoConfig, () => {
  const discoveredPaths = ['packages/arrays', 'packages/strings'];

  it('builds default components from discovered paths', () => {
    const result = mergeMonorepoConfig(discoveredPaths, undefined);

    expect(result.components).toHaveLength(2);
    expect(result.components[0]).toStrictEqual({
      dir: 'arrays',
      tagPrefix: 'arrays-v',
      packageFiles: ['packages/arrays/package.json'],
      changelogPaths: ['packages/arrays'],
      paths: ['packages/arrays/**'],
    });
  });

  it('builds components from non-standard workspace paths', () => {
    const result = mergeMonorepoConfig(['libs/core', 'apps/web'], undefined);

    expect(result.components).toHaveLength(2);
    expect(result.components[0]).toStrictEqual({
      dir: 'core',
      tagPrefix: 'core-v',
      packageFiles: ['libs/core/package.json'],
      changelogPaths: ['libs/core'],
      paths: ['libs/core/**'],
    });
  });

  it('uses default workTypes when no config is provided', () => {
    const result = mergeMonorepoConfig(discoveredPaths, undefined);
    expect(result.workTypes).toStrictEqual(DEFAULT_WORK_TYPES);
  });

  it('uses default versionPatterns when no config is provided', () => {
    const result = mergeMonorepoConfig(discoveredPaths, undefined);
    expect(result.versionPatterns).toStrictEqual(DEFAULT_VERSION_PATTERNS);
  });

  it('excludes components with shouldExclude', () => {
    const result = mergeMonorepoConfig(discoveredPaths, {
      components: [{ dir: 'strings', shouldExclude: true }],
    });

    expect(result.components).toHaveLength(1);
    expect(result.components[0]?.tagPrefix).toBe('arrays-v');
  });

  it('merges custom workTypes with defaults', () => {
    const result = mergeMonorepoConfig(discoveredPaths, {
      workTypes: { perf: { header: 'Performance' } },
    });

    expect(result.workTypes?.perf).toStrictEqual({ header: 'Performance' });
    expect(result.workTypes?.fix).toStrictEqual(DEFAULT_WORK_TYPES.fix);
  });

  it('replaces versionPatterns entirely when provided', () => {
    const customPatterns = { major: ['!', 'breaking'], minor: ['feat', 'perf'] };
    const result = mergeMonorepoConfig(discoveredPaths, {
      versionPatterns: customPatterns,
    });

    expect(result.versionPatterns).toStrictEqual(customPatterns);
  });

  it('passes through formatCommand from config', () => {
    const result = mergeMonorepoConfig(discoveredPaths, {
      formatCommand: 'pnpm run fmt',
    });

    expect(result.formatCommand).toBe('pnpm run fmt');
  });

  it('passes through cliffConfigPath from config', () => {
    const result = mergeMonorepoConfig(discoveredPaths, {
      cliffConfigPath: 'custom/cliff.toml',
    });

    expect(result.cliffConfigPath).toBe('custom/cliff.toml');
  });

  it('passes through scopeAliases from config', () => {
    const result = mergeMonorepoConfig(discoveredPaths, {
      scopeAliases: { api: 'backend-api' },
    });

    expect(result.scopeAliases).toStrictEqual({ api: 'backend-api' });
  });
});

describe(mergeSinglePackageConfig, () => {
  it('returns defaults when no config is provided', () => {
    const result = mergeSinglePackageConfig(undefined);

    expect(result.tagPrefix).toBe('v');
    expect(result.packageFiles).toStrictEqual(['package.json']);
    expect(result.changelogPaths).toStrictEqual(['.']);
    expect(result.workTypes).toStrictEqual(DEFAULT_WORK_TYPES);
    expect(result.versionPatterns).toStrictEqual(DEFAULT_VERSION_PATTERNS);
  });

  it('merges custom workTypes with defaults', () => {
    const result = mergeSinglePackageConfig({
      workTypes: { perf: { header: 'Performance' } },
    });

    expect(result.workTypes?.perf).toStrictEqual({ header: 'Performance' });
    expect(result.workTypes?.fix).toStrictEqual(DEFAULT_WORK_TYPES.fix);
  });

  it('replaces versionPatterns entirely when provided', () => {
    const customPatterns = { major: ['!'], minor: ['feat', 'perf'] };
    const result = mergeSinglePackageConfig({ versionPatterns: customPatterns });

    expect(result.versionPatterns).toStrictEqual(customPatterns);
  });

  it('passes through scalar overrides', () => {
    const result = mergeSinglePackageConfig({
      formatCommand: 'pnpm run fmt',
      cliffConfigPath: 'custom/cliff.toml',
      scopeAliases: { api: 'backend-api' },
    });

    expect(result.formatCommand).toBe('pnpm run fmt');
    expect(result.cliffConfigPath).toBe('custom/cliff.toml');
    expect(result.scopeAliases).toStrictEqual({ api: 'backend-api' });
  });
});
