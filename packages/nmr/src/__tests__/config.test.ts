import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defineConfig, loadConfig, loadWorkspaceConfig } from '../config.ts';

/** Writes a config file into `dir/.config/nmr.config.ts`, creating the directory. */
function writeConfig(dir: string, source: string): void {
  const configDir = path.join(dir, '.config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'nmr.config.ts'), source);
}

describe(defineConfig, () => {
  it('returns the config unchanged (identity function)', () => {
    const config = {
      workspaceScripts: {
        'copy-content': 'tsx scripts/copy-content.ts',
      },
      rootScripts: {
        demo: 'pnpx http-server --port=5189',
      },
    };

    expect(defineConfig(config)).toBe(config);
  });

  it('accepts string[] values for script definitions', () => {
    const config = defineConfig({
      workspaceScripts: {
        verify: ['compile', 'test'],
      },
    });

    expect(config.workspaceScripts?.verify).toStrictEqual(['compile', 'test']);
  });

  it('accepts an empty config', () => {
    expect(defineConfig({})).toStrictEqual({});
  });

  it('accepts a config with devBin', () => {
    const config = defineConfig({
      devBin: {
        'my-cli': 'tsx packages/my-cli/src/cli.ts',
      },
    });

    expect(config.devBin).toStrictEqual({ 'my-cli': 'tsx packages/my-cli/src/cli.ts' });
  });
});

describe(loadConfig, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(os.tmpdir() + '/nmr-config-test-');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns empty config when config file does not exist', async () => {
    const config = await loadConfig(tmpDir);
    expect(config).toStrictEqual({});
  });

  it('returns empty config for a non-existent directory', async () => {
    const config = await loadConfig('/tmp/nonexistent-monorepo-root');
    expect(config).toStrictEqual({});
  });

  it('loads a config with a valid devBin mapping', async () => {
    const configDir = path.join(tmpDir, '.config');
    fs.mkdirSync(configDir);
    fs.writeFileSync(
      path.join(configDir, 'nmr.config.ts'),
      `export default { devBin: { 'my-cli': 'tsx packages/my-cli/src/cli.ts' } };`,
    );

    const config = await loadConfig(tmpDir);
    expect(config.devBin).toStrictEqual({ 'my-cli': 'tsx packages/my-cli/src/cli.ts' });
  });

  it('throws when devBin contains a non-string value', async () => {
    const configDir = path.join(tmpDir, '.config');
    fs.mkdirSync(configDir);
    fs.writeFileSync(path.join(configDir, 'nmr.config.ts'), `export default { devBin: { 'my-cli': 123 } };`);

    await expect(loadConfig(tmpDir)).rejects.toThrow('`devBin` must be a Record<string, string>');
  });

  it('loads a config without devBin (backward compatibility)', async () => {
    const configDir = path.join(tmpDir, '.config');
    fs.mkdirSync(configDir);
    fs.writeFileSync(
      path.join(configDir, 'nmr.config.ts'),
      `export default { workspaceScripts: { hello: 'echo hello' } };`,
    );

    const config = await loadConfig(tmpDir);
    expect(config.devBin).toBeUndefined();
    expect(config.workspaceScripts).toStrictEqual({ hello: 'echo hello' });
  });

  it('loads build.extraIgnorePatterns', async () => {
    writeConfig(tmpDir, `export default { build: { extraIgnorePatterns: ['**/fixtures/**'] } };`);

    const config = await loadConfig(tmpDir);

    expect(config.build).toStrictEqual({ extraIgnorePatterns: ['**/fixtures/**'] });
  });

  it('throws when build is not an object', async () => {
    writeConfig(tmpDir, `export default { build: 'nope' };`);

    await expect(loadConfig(tmpDir)).rejects.toThrow('`build` must be an object');
  });

  it('throws when build.extraIgnorePatterns is not an array of strings', async () => {
    writeConfig(tmpDir, `export default { build: { extraIgnorePatterns: ['ok', 7] } };`);

    await expect(loadConfig(tmpDir)).rejects.toThrow('`build.extraIgnorePatterns` must be a string[]');
  });
});

describe(loadWorkspaceConfig, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(os.tmpdir() + '/nmr-workspace-config-test-');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns an empty config when the package has no config file', async () => {
    await expect(loadWorkspaceConfig(tmpDir)).resolves.toStrictEqual({});
  });

  it('loads a config declaring build alone', async () => {
    writeConfig(tmpDir, `export default { build: { extraIgnorePatterns: ['**/fixtures/**'] } };`);

    const config = await loadWorkspaceConfig(tmpDir);

    expect(config.build).toStrictEqual({ extraIgnorePatterns: ['**/fixtures/**'] });
  });

  it('throws naming every root-tier key the package config declares', async () => {
    // Silently dropping these would leave the package running on settings its own config appears to set.
    writeConfig(tmpDir, `export default { rootScripts: { a: 'x' }, devBin: { b: 'y' }, build: {} };`);

    await expect(loadWorkspaceConfig(tmpDir)).rejects.toThrow('not devBin, rootScripts');
  });
});
