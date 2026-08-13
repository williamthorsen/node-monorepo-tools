import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig, loadRootConfig, loadWorkspaceConfig } from '../config.ts';
import { UserError } from '../UserError.ts';

/** Writes a config file into `dir/.config/nmr.config.ts`, creating the directory. */
function writeConfig(dir: string, source: string): void {
  const configDir = path.join(dir, '.config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'nmr.config.ts'), source);
}

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

  // The class, not the message, is what the CLI boundary reads to print a config error without a stack trace.
  it('rejects an invalid config as a UserError', async () => {
    writeConfig(tmpDir, `export default { devBin: { 'my-cli': 123 } };`);

    await expect(loadConfig(tmpDir)).rejects.toThrow(UserError);
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

  it('throws naming an unrecognized top-level key and the recognized set', async () => {
    writeConfig(tmpDir, `export default { bild: { extraIgnorePatterns: ['**/fixtures/**'] } };`);

    await expect(loadConfig(tmpDir)).rejects.toThrow(
      'unrecognized key `bild`. Recognized: `build`, `checkCache`, `devBin`, `output`, `rootScripts`, ' +
        '`workspaceScripts`.',
    );
  });

  it('throws naming every unrecognized top-level key at once', async () => {
    writeConfig(tmpDir, `export default { zeta: 1, alpha: 2 };`);

    await expect(loadConfig(tmpDir)).rejects.toThrow('unrecognized keys `alpha`, `zeta`');
  });

  it('loads every checkCache field', async () => {
    writeConfig(
      tmpDir,
      `export default { checkCache: { enabled: false, extraCommands: ['verify'], excludeCommands: ['test'] } };`,
    );

    const config = await loadConfig(tmpDir);

    expect(config.checkCache).toStrictEqual({
      enabled: false,
      excludeCommands: ['test'],
      extraCommands: ['verify'],
    });
  });

  it('throws when checkCache is not an object', async () => {
    writeConfig(tmpDir, `export default { checkCache: true };`);

    await expect(loadConfig(tmpDir)).rejects.toThrow('`checkCache` must be an object');
  });

  it('throws when checkCache.enabled is not a boolean', async () => {
    writeConfig(tmpDir, `export default { checkCache: { enabled: 'no' } };`);

    await expect(loadConfig(tmpDir)).rejects.toThrow('`checkCache.enabled` must be a boolean');
  });

  it('throws when checkCache.extraCommands is not an array of strings', async () => {
    writeConfig(tmpDir, `export default { checkCache: { extraCommands: ['ok', 7] } };`);

    await expect(loadConfig(tmpDir)).rejects.toThrow('`checkCache.extraCommands` must be a string[]');
  });

  it('throws when checkCache.excludeCommands is not an array of strings', async () => {
    writeConfig(tmpDir, `export default { checkCache: { excludeCommands: 'test' } };`);

    await expect(loadConfig(tmpDir)).rejects.toThrow('`checkCache.excludeCommands` must be a string[]');
  });

  it('throws naming an unrecognized checkCache subkey', async () => {
    // A misspelled subkey is a setting nothing reads, which no output of a cached run would reveal.
    writeConfig(tmpDir, `export default { checkCache: { extraCommand: ['verify'] } };`);

    await expect(loadConfig(tmpDir)).rejects.toThrow(
      'unrecognized key `checkCache.extraCommand`. Recognized: `checkCache.enabled`, ' +
        '`checkCache.excludeCommands`, `checkCache.extraCommands`.',
    );
  });

  it('loads a composite script whose elements are command names', async () => {
    writeConfig(tmpDir, `export default { rootScripts: { check: ['typecheck', '-q test'] } };`);

    const config = await loadConfig(tmpDir);

    expect(config.rootScripts).toStrictEqual({ check: ['typecheck', '-q test'] });
  });

  it('loads a composite script whose element declares what it does with trailing arguments', async () => {
    writeConfig(
      tmpDir,
      `export default { rootScripts: { check: [{ run: 'typecheck', declinesArgs: true }, 'test'] } };`,
    );

    const config = await loadConfig(tmpDir);

    expect(config.rootScripts).toStrictEqual({ check: [{ run: 'typecheck', declinesArgs: true }, 'test'] });
  });

  it('throws naming the composite element and the token that puts it outside the grammar', async () => {
    writeConfig(tmpDir, `export default { rootScripts: { check: ['build && echo done'] } };`);

    await expect(loadConfig(tmpDir)).rejects.toThrow('`rootScripts.check` element `build && echo done` carries `&&`');
  });

  it('holds a spec element to the same grammar its bare string is held to', async () => {
    writeConfig(tmpDir, `export default { rootScripts: { check: [{ run: 'build && echo done' }] } };`);

    await expect(loadConfig(tmpDir)).rejects.toThrow('`rootScripts.check` element `build && echo done` carries `&&`');
  });

  it('throws naming the shape when an element is neither a string nor a spec', async () => {
    writeConfig(tmpDir, `export default { rootScripts: { check: [{ command: 'typecheck' }] } };`);

    await expect(loadConfig(tmpDir)).rejects.toThrow('`rootScripts` must be a Record<string, string | element[]>');
  });

  it('throws when a spec declares a non-boolean policy', async () => {
    writeConfig(tmpDir, `export default { rootScripts: { check: [{ run: 'typecheck', declinesArgs: 'yes' }] } };`);

    await expect(loadConfig(tmpDir)).rejects.toThrow('`rootScripts` must be a Record<string, string | element[]>');
  });

  it('throws naming an unrecognized build subkey', async () => {
    writeConfig(tmpDir, `export default { build: { extendIgnore: ['**/fixtures/**'] } };`);

    await expect(loadConfig(tmpDir)).rejects.toThrow(
      'unrecognized key `build.extendIgnore`. Recognized: `build.extraIgnorePatterns`.',
    );
  });

  it('loads every output field', async () => {
    writeConfig(tmpDir, `export default { output: { commandVerbosity: 'quiet', extraAgentEnvVars: ['MY_CLI'] } };`);

    const config = await loadConfig(tmpDir);

    expect(config.output).toStrictEqual({ commandVerbosity: 'quiet', extraAgentEnvVars: ['MY_CLI'] });
  });

  it('throws when output is not an object', async () => {
    writeConfig(tmpDir, `export default { output: 'quiet' };`);

    await expect(loadConfig(tmpDir)).rejects.toThrow('`output` must be an object');
  });

  it.each([
    { scenario: 'a point that is not on the ladder', value: `'silent'` },
    { scenario: 'a recognized value in the wrong case', value: `'QUIET'` },
    { scenario: 'a value that is not a string at all', value: '0' },
  ])('throws naming both accepted values given $scenario', async ({ value }) => {
    writeConfig(tmpDir, `export default { output: { commandVerbosity: ${value} } };`);

    await expect(loadConfig(tmpDir)).rejects.toThrow(
      '`output.commandVerbosity` is `' + value.replaceAll(`'`, '') + '`, which is not one of: full, quiet',
    );
  });

  it('throws when output.extraAgentEnvVars is not an array of strings', async () => {
    writeConfig(tmpDir, `export default { output: { extraAgentEnvVars: 'MY_CLI' } };`);

    await expect(loadConfig(tmpDir)).rejects.toThrow('`output.extraAgentEnvVars` must be a string[]');
  });

  it('throws naming an unrecognized output subkey', async () => {
    writeConfig(tmpDir, `export default { output: { agentEnvVars: ['MY_CLI'] } };`);

    await expect(loadConfig(tmpDir)).rejects.toThrow(
      'unrecognized key `output.agentEnvVars`. Recognized: `output.commandVerbosity`, `output.extraAgentEnvVars`.',
    );
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
    writeConfig(
      tmpDir,
      `export default { rootScripts: { a: 'x' }, devBin: { b: 'y' }, output: { commandVerbosity: 'quiet' }, build: {} };`,
    );

    await expect(loadWorkspaceConfig(tmpDir)).rejects.toThrow('not devBin, output, rootScripts');
  });
});

describe(loadRootConfig, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(os.tmpdir() + '/nmr-root-config-test-');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns an empty config when the root has no config file', async () => {
    await expect(loadRootConfig(tmpDir)).resolves.toStrictEqual({});
  });

  it('loads the script and devBin keys the root tier honors', async () => {
    writeConfig(
      tmpDir,
      `export default { rootScripts: { a: 'x' }, workspaceScripts: { b: 'y' }, devBin: { c: 'z' } };`,
    );

    const config = await loadRootConfig(tmpDir);

    expect(config.rootScripts).toStrictEqual({ a: 'x' });
  });

  it('loads output, which the root tier honors', async () => {
    writeConfig(tmpDir, `export default { output: { commandVerbosity: 'quiet' } };`);

    const config = await loadRootConfig(tmpDir);

    expect(config.output).toStrictEqual({ commandVerbosity: 'quiet' });
  });

  it('loads checkCache, which the root tier honors', async () => {
    writeConfig(tmpDir, `export default { checkCache: { excludeCommands: ['test:coverage'] } };`);

    const config = await loadRootConfig(tmpDir);

    expect(config.checkCache).toStrictEqual({ excludeCommands: ['test:coverage'] });
  });

  it('throws when the root config declares build, which only a package config reaches', async () => {
    writeConfig(tmpDir, `export default { build: { extraIgnorePatterns: ['**/fixtures/**'] } };`);

    await expect(loadRootConfig(tmpDir)).rejects.toThrow(
      'honors checkCache, devBin, output, rootScripts, workspaceScripts alone, not build. ' +
        "Move those keys to the package's own config.",
    );
  });
});
