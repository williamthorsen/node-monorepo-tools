import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

// The loader suite imports a real file from disk, so it needs the unmocked module that the suite below replaces.
const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');

import { CONFIG_FILE_PATH, loadConfig, readRootPackageVersion } from '../loadConfig.ts';

describe(loadConfig, () => {
  let tree: TempTree;
  let cwdSpy: MockInstance<() => string>;

  beforeEach(() => {
    // Create a fresh directory per test. `import()` caches by URL for the process lifetime, so a reused fixture path
    // would replay the first config and pass every later case for the wrong reason.
    tree = disposeOnTestFinished(createTempTree({}, { prefix: 'release-kit-config-' }));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tree.dir);
    // Delegate to the real `existsSync`, so that `loadConfig` reports a mistyped fixture path as a missing config rather
    // than as an opaque module-resolution failure from the import.
    mockExistsSync.mockImplementation(actualFs.existsSync);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  it('returns undefined when the config file does not exist', async () => {
    const result = await loadConfig();

    expect(result).toBeUndefined();
  });

  it('resolves the config path against process.cwd()', async () => {
    writeConfig('export default { formatCommand: "pnpm run fmt" };');

    await loadConfig();

    expect(mockExistsSync).toHaveBeenCalledWith(tree.resolve(CONFIG_FILE_PATH));
  });

  it('returns the default export when present', async () => {
    writeConfig('export default { workTypes: { perf: { header: "Performance" } } };');

    const result = await loadConfig();

    expect(result).toStrictEqual({ workTypes: { perf: { header: 'Performance' } } });
  });

  it('returns the named config export when the module does not have a default export', async () => {
    writeConfig('export const config = { formatCommand: "pnpm run fmt" };');

    const result = await loadConfig();

    expect(result).toStrictEqual({ formatCommand: 'pnpm run fmt' });
  });

  it('prefers the default export over the named config export', async () => {
    writeConfig('export default { formatCommand: "default" };\nexport const config = { formatCommand: "named" };');

    const result = await loadConfig();

    expect(result).toStrictEqual({ formatCommand: 'default' });
  });

  it('throws when the module has neither a default nor a named config export', async () => {
    writeConfig('export const unrelated = true;');

    await expect(loadConfig()).rejects.toThrow('must have a default export or a named `config` export');
  });

  it('loads the named path when one is given', async () => {
    tree.write('elsewhere/alternative.config.ts', 'export default { formatCommand: "pnpm run alt" };');

    const result = await loadConfig('elsewhere/alternative.config.ts');

    expect(result).toStrictEqual({ formatCommand: 'pnpm run alt' });
  });

  it('prefers the named path over an existing default config', async () => {
    writeConfig('export default { formatCommand: "default" };');
    tree.write('elsewhere/alternative.config.ts', 'export default { formatCommand: "named" };');

    const result = await loadConfig('elsewhere/alternative.config.ts');

    expect(result).toStrictEqual({ formatCommand: 'named' });
  });

  it('rejects with the resolved path when the named path does not exist', async () => {
    await expect(loadConfig('elsewhere/absent.config.ts')).rejects.toThrow(
      `Config file not found: ${tree.resolve('elsewhere/absent.config.ts')}`,
    );
  });

  /** Writes `source` to the config path that the loader resolves under the temp directory standing in for the cwd. */
  function writeConfig(source: string): void {
    tree.write(CONFIG_FILE_PATH, source);
  }
});

describe(readRootPackageVersion, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  it('returns exists=false when the root package.json is missing', () => {
    mockExistsSync.mockReturnValue(false);
    expect(readRootPackageVersion()).toStrictEqual({ exists: false, version: undefined });
  });

  it('returns the version when the root package.json declares one', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'root', version: '1.2.3' }));
    expect(readRootPackageVersion()).toStrictEqual({ exists: true, version: '1.2.3' });
  });

  it('returns version=undefined when the root package.json does not have a version field', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'root' }));
    expect(readRootPackageVersion()).toStrictEqual({ exists: true, version: undefined });
  });

  it('throws an error when the root package.json contains invalid JSON', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{ not valid json');
    expect(() => readRootPackageVersion()).toThrow(/Failed to parse root package\.json/);
  });

  it('throws an error when reading the root package.json fails (I/O error)', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('permission denied');
    });
    expect(() => readRootPackageVersion()).toThrow(/Failed to read root package\.json/);
  });

  it('preserves the underlying error as the cause when the root package.json cannot be read', () => {
    const underlying = new Error('permission denied');
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw underlying;
    });
    expect(() => readRootPackageVersion()).toThrow(expect.objectContaining({ cause: underlying }));
  });

  it('preserves the underlying error as the cause when the root package.json holds invalid JSON', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{ not valid json');
    expect(() => readRootPackageVersion()).toThrow(expect.objectContaining({ cause: expect.any(SyntaxError) }));
  });
});
