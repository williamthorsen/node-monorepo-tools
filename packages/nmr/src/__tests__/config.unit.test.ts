import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { loadConfig, loadRootConfig, loadWorkspaceConfig } from '../config.ts';
import { UserError } from '../UserError.ts';

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-config-' })),
);

describe(loadConfig, () => {
  it('returns empty config when config file does not exist', async ({ tree }) => {
    const config = await loadConfig(tree.dir);
    expect(config).toStrictEqual({});
  });

  it('returns empty config for a non-existent directory', async () => {
    const config = await loadConfig('/tmp/nonexistent-monorepo-root');
    expect(config).toStrictEqual({});
  });

  it('loads a config with a valid devBin mapping', async ({ tree }) => {
    writeConfig(tree, `export default { devBin: { 'my-cli': 'tsx packages/my-cli/src/cli.ts' } };`);

    const config = await loadConfig(tree.dir);
    expect(config.devBin).toStrictEqual({ 'my-cli': 'tsx packages/my-cli/src/cli.ts' });
  });

  // The class, not the message, is what the CLI boundary reads to print a config error without a stack trace.
  it('rejects an invalid config as a UserError', async ({ tree }) => {
    writeConfig(tree, `export default { devBin: { 'my-cli': 123 } };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow(UserError);
  });

  it('throws when devBin contains a non-string value', async ({ tree }) => {
    writeConfig(tree, `export default { devBin: { 'my-cli': 123 } };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow('`devBin` must be a Record<string, string>');
  });

  it('loads a config without devBin (backward compatibility)', async ({ tree }) => {
    writeConfig(tree, `export default { workspaceScripts: { hello: 'echo hello' } };`);

    const config = await loadConfig(tree.dir);
    expect(config.devBin).toBeUndefined();
    expect(config.workspaceScripts).toStrictEqual({ hello: 'echo hello' });
  });

  it('loads build.extraIgnorePatterns', async ({ tree }) => {
    writeConfig(tree, `export default { build: { extraIgnorePatterns: ['**/fixtures/**'] } };`);

    const config = await loadConfig(tree.dir);

    expect(config.build).toStrictEqual({ extraIgnorePatterns: ['**/fixtures/**'] });
  });

  it('throws when build is not an object', async ({ tree }) => {
    writeConfig(tree, `export default { build: 'nope' };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow('`build` must be an object');
  });

  it('throws when build.extraIgnorePatterns is not an array of strings', async ({ tree }) => {
    writeConfig(tree, `export default { build: { extraIgnorePatterns: ['ok', 7] } };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow('`build.extraIgnorePatterns` must be a string[]');
  });

  it('throws naming an unrecognized top-level key and the recognized set', async ({ tree }) => {
    writeConfig(tree, `export default { bild: { extraIgnorePatterns: ['**/fixtures/**'] } };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow(
      'unrecognized key `bild`. Recognized: `build`, `checkCache`, `devBin`, `output`, `rootScripts`, ' +
        '`workspaceScripts`.',
    );
  });

  it('throws naming every unrecognized top-level key at once', async ({ tree }) => {
    writeConfig(tree, `export default { zeta: 1, alpha: 2 };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow('unrecognized keys `alpha`, `zeta`');
  });

  it('loads every checkCache field', async ({ tree }) => {
    writeConfig(
      tree,
      `export default { checkCache: { enabled: false, extraCommands: ['verify'], excludeCommands: ['test'] } };`,
    );

    const config = await loadConfig(tree.dir);

    expect(config.checkCache).toStrictEqual({
      enabled: false,
      excludeCommands: ['test'],
      extraCommands: ['verify'],
    });
  });

  it('throws when checkCache is not an object', async ({ tree }) => {
    writeConfig(tree, `export default { checkCache: true };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow('`checkCache` must be an object');
  });

  it('throws when checkCache.enabled is not a boolean', async ({ tree }) => {
    writeConfig(tree, `export default { checkCache: { enabled: 'no' } };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow('`checkCache.enabled` must be a boolean');
  });

  it('throws when checkCache.extraCommands is not an array of strings', async ({ tree }) => {
    writeConfig(tree, `export default { checkCache: { extraCommands: ['ok', 7] } };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow('`checkCache.extraCommands` must be a string[]');
  });

  it('throws when checkCache.excludeCommands is not an array of strings', async ({ tree }) => {
    writeConfig(tree, `export default { checkCache: { excludeCommands: 'test' } };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow('`checkCache.excludeCommands` must be a string[]');
  });

  it('throws naming an unrecognized checkCache subkey', async ({ tree }) => {
    // A misspelled subkey is a setting nothing reads, which no output of a cached run would reveal.
    writeConfig(tree, `export default { checkCache: { extraCommand: ['verify'] } };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow(
      'unrecognized key `checkCache.extraCommand`. Recognized: `checkCache.enabled`, ' +
        '`checkCache.excludeCommands`, `checkCache.extraCommands`.',
    );
  });

  it('loads a composite script whose elements are command names', async ({ tree }) => {
    writeConfig(tree, `export default { rootScripts: { check: ['typecheck', '-q test'] } };`);

    const config = await loadConfig(tree.dir);

    expect(config.rootScripts).toStrictEqual({ check: ['typecheck', '-q test'] });
  });

  it('loads a composite script whose element declares what it does with trailing arguments', async ({ tree }) => {
    writeConfig(tree, `export default { rootScripts: { check: [{ run: 'typecheck', declinesArgs: true }, 'test'] } };`);

    const config = await loadConfig(tree.dir);

    expect(config.rootScripts).toStrictEqual({ check: [{ run: 'typecheck', declinesArgs: true }, 'test'] });
  });

  it('throws naming the composite element and the token that puts it outside the grammar', async ({ tree }) => {
    writeConfig(tree, `export default { rootScripts: { check: ['build && echo done'] } };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow('`rootScripts.check` element `build && echo done` carries `&&`');
  });

  it('holds a spec element to the same grammar its bare string is held to', async ({ tree }) => {
    writeConfig(tree, `export default { rootScripts: { check: [{ run: 'build && echo done' }] } };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow('`rootScripts.check` element `build && echo done` carries `&&`');
  });

  it('throws naming the shape when an element is neither a string nor a spec', async ({ tree }) => {
    writeConfig(tree, `export default { rootScripts: { check: [{ command: 'typecheck' }] } };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow('`rootScripts` must be a Record<string, string | element[]>');
  });

  it('throws naming an unrecognized spec key, which would otherwise read as the default', async ({ tree }) => {
    writeConfig(tree, `export default { rootScripts: { check: [{ run: 'typecheck', declineArgs: true }] } };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow(
      'unrecognized key `rootScripts.check.declineArgs`. Recognized: `rootScripts.check.declinesArgs`, ' +
        '`rootScripts.check.run`.',
    );
  });

  it('throws when a spec declares a non-boolean policy', async ({ tree }) => {
    writeConfig(tree, `export default { rootScripts: { check: [{ run: 'typecheck', declinesArgs: 'yes' }] } };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow('`rootScripts` must be a Record<string, string | element[]>');
  });

  it('throws naming an unrecognized build subkey', async ({ tree }) => {
    writeConfig(tree, `export default { build: { extendIgnore: ['**/fixtures/**'] } };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow(
      'unrecognized key `build.extendIgnore`. Recognized: `build.extraIgnorePatterns`.',
    );
  });

  it('loads every output field', async ({ tree }) => {
    writeConfig(tree, `export default { output: { commandVerbosity: 'quiet', extraAgentEnvVars: ['MY_CLI'] } };`);

    const config = await loadConfig(tree.dir);

    expect(config.output).toStrictEqual({ commandVerbosity: 'quiet', extraAgentEnvVars: ['MY_CLI'] });
  });

  it('throws when output is not an object', async ({ tree }) => {
    writeConfig(tree, `export default { output: 'quiet' };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow('`output` must be an object');
  });

  it.for([
    { scenario: 'a point that is not on the ladder', value: `'silent'` },
    { scenario: 'a recognized value in the wrong case', value: `'QUIET'` },
    { scenario: 'a value that is not a string at all', value: '0' },
  ])('throws naming both accepted values given $scenario', async ({ value }, { tree }) => {
    writeConfig(tree, `export default { output: { commandVerbosity: ${value} } };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow(
      '`output.commandVerbosity` is `' + value.replaceAll(`'`, '') + '`, which is not one of: full, quiet',
    );
  });

  it('throws when output.extraAgentEnvVars is not an array of strings', async ({ tree }) => {
    writeConfig(tree, `export default { output: { extraAgentEnvVars: 'MY_CLI' } };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow('`output.extraAgentEnvVars` must be a string[]');
  });

  it('throws naming an unrecognized output subkey', async ({ tree }) => {
    writeConfig(tree, `export default { output: { agentEnvVars: ['MY_CLI'] } };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow(
      'unrecognized key `output.agentEnvVars`. Recognized: `output.commandVerbosity`, `output.extraAgentEnvVars`.',
    );
  });
});

describe(loadWorkspaceConfig, () => {
  it('returns an empty config when the package has no config file', async ({ tree }) => {
    await expect(loadWorkspaceConfig(tree.dir)).resolves.toStrictEqual({});
  });

  it('loads a config declaring build alone', async ({ tree }) => {
    writeConfig(tree, `export default { build: { extraIgnorePatterns: ['**/fixtures/**'] } };`);

    const config = await loadWorkspaceConfig(tree.dir);

    expect(config.build).toStrictEqual({ extraIgnorePatterns: ['**/fixtures/**'] });
  });

  it('throws naming every root-tier key the package config declares', async ({ tree }) => {
    // Silently dropping these would leave the package running on settings its own config appears to set.
    writeConfig(
      tree,
      `export default { rootScripts: { a: 'x' }, devBin: { b: 'y' }, output: { commandVerbosity: 'quiet' }, build: {} };`,
    );

    await expect(loadWorkspaceConfig(tree.dir)).rejects.toThrow('not devBin, output, rootScripts');
  });
});

describe(loadRootConfig, () => {
  it('returns an empty config when the root has no config file', async ({ tree }) => {
    await expect(loadRootConfig(tree.dir)).resolves.toStrictEqual({});
  });

  it('loads the script and devBin keys the root tier honors', async ({ tree }) => {
    writeConfig(tree, `export default { rootScripts: { a: 'x' }, workspaceScripts: { b: 'y' }, devBin: { c: 'z' } };`);

    const config = await loadRootConfig(tree.dir);

    expect(config.rootScripts).toStrictEqual({ a: 'x' });
  });

  it('loads output, which the root tier honors', async ({ tree }) => {
    writeConfig(tree, `export default { output: { commandVerbosity: 'quiet' } };`);

    const config = await loadRootConfig(tree.dir);

    expect(config.output).toStrictEqual({ commandVerbosity: 'quiet' });
  });

  it('loads checkCache, which the root tier honors', async ({ tree }) => {
    writeConfig(tree, `export default { checkCache: { excludeCommands: ['test:coverage'] } };`);

    const config = await loadRootConfig(tree.dir);

    expect(config.checkCache).toStrictEqual({ excludeCommands: ['test:coverage'] });
  });

  it('throws when the root config declares build, which only a package config reaches', async ({ tree }) => {
    writeConfig(tree, `export default { build: { extraIgnorePatterns: ['**/fixtures/**'] } };`);

    await expect(loadRootConfig(tree.dir)).rejects.toThrow(
      'honors checkCache, devBin, output, rootScripts, workspaceScripts alone, not build. ' +
        "Move those keys to the package's own config.",
    );
  });
});

describe('checkCache command resolution', () => {
  it('accepts a name the repo config declares', async ({ tree }) => {
    makeMonorepoRoot(tree);
    writeConfig(
      tree,
      `export default { rootScripts: { 'verify:contracts': 'node verify.js' }, ` +
        `checkCache: { extraCommands: ['verify:contracts'] } };`,
    );

    const config = await loadConfig(tree.dir);

    expect(config.checkCache).toStrictEqual({ extraCommands: ['verify:contracts'] });
  });

  it('accepts a name only a package.json declares', async ({ tree }) => {
    makeMonorepoRoot(tree);
    writePackage(tree, 'core', { 'verify:contracts': 'node verify.js' });
    writeConfig(tree, `export default { checkCache: { extraCommands: ['verify:contracts'] } };`);

    const config = await loadConfig(tree.dir);

    expect(config.checkCache).toStrictEqual({ extraCommands: ['verify:contracts'] });
  });

  it('rejects an extraCommands name that matches no command', async ({ tree }) => {
    makeMonorepoRoot(tree);
    writeConfig(tree, `export default { checkCache: { extraCommands: ['nonesuch-command'] } };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow(
      '`checkCache.extraCommands` names no command: `nonesuch-command`',
    );
  });

  it('rejects an excludeCommands name that matches no command', async ({ tree }) => {
    makeMonorepoRoot(tree);
    writeConfig(tree, `export default { checkCache: { excludeCommands: ['nonesuch-command'] } };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow(
      '`checkCache.excludeCommands` names no command: `nonesuch-command`',
    );
  });

  // The sweep is what a repo pays on every invocation, so a config that needs none must not trigger one. A
  // directory standing where the manifest belongs is the probe: it fails the read itself, which no swallow
  // covers, so a sweep would surface as `EISDIR`.
  it('reads no package.json while every name resolves', async ({ tree }) => {
    makeMonorepoRoot(tree);
    tree.write('packages/core/package.json/placeholder', '');
    writeConfig(tree, `export default { checkCache: { extraCommands: ['typecheck'] } };`);

    const config = await loadConfig(tree.dir);

    expect(config.checkCache).toStrictEqual({ extraCommands: ['typecheck'] });
  });

  // A manifest is swept for the config's sake, so one that is malformed elsewhere in the workspace must not
  // stand in for the answer the reader asked for.
  it('rejects an unresolvable name past a manifest whose content does not parse', async ({ tree }) => {
    makeMonorepoRoot(tree);
    tree.write('packages/core/package.json', '{ not json');
    writeConfig(tree, `export default { checkCache: { extraCommands: ['nonesuch-command'] } };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow(
      '`checkCache.extraCommands` names no command: `nonesuch-command`',
    );
  });

  // The unreadable path is a fault in the checkout, which nothing else in a config load would report.
  it('propagates a package manifest that cannot be read at all', async ({ tree }) => {
    makeMonorepoRoot(tree);
    tree.write('packages/core/package.json/placeholder', '');
    writeConfig(tree, `export default { checkCache: { extraCommands: ['nonesuch-command'] } };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow('EISDIR');
  });

  it('rejects a hook name, which the gate never consults', async ({ tree }) => {
    makeMonorepoRoot(tree);
    writeConfig(tree, `export default { checkCache: { extraCommands: ['check:strict:post'] } };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow(
      '`checkCache.extraCommands` names the hook `check:strict:post`, which is never gated on its own',
    );
  });

  it('names the closest command in the rejection', async ({ tree }) => {
    makeMonorepoRoot(tree);
    writeConfig(tree, `export default { checkCache: { extraCommands: ['typechek'] } };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow('`typechek`. Did you mean `typecheck`?');
  });

  it('offers no suggestion for a name close to nothing', async ({ tree }) => {
    makeMonorepoRoot(tree);
    writeConfig(tree, `export default { checkCache: { extraCommands: ['zzzzzzzzzzzzzzzzzzzz'] } };`);

    await expect(loadConfig(tree.dir)).rejects.toThrow(/`zzzzzzzzzzzzzzzzzzzz`\.$/);
  });

  // `checkCache` belongs to the root tier, and naming its misplacement is more use than naming a name it holds.
  it('stands aside for a package config, whose tier rejection is the accurate one', async ({ tree }) => {
    writeConfig(tree, `export default { checkCache: { extraCommands: ['nonesuch-command'] } };`);

    await expect(loadWorkspaceConfig(tree.dir)).rejects.toThrow('honors build alone, not checkCache');
  });
});

// region | Helpers

/** Turns the tree into a monorepo root, the only tier at which `checkCache` names are resolved. */
function makeMonorepoRoot(tree: TempTree): void {
  tree.write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
}

/** Writes a config file into the tree's `.config/nmr.config.ts`. */
function writeConfig(tree: TempTree, source: string): void {
  tree.write('.config/nmr.config.ts', source);
}

/** Writes a workspace package declaring the given `package.json` scripts. */
function writePackage(tree: TempTree, name: string, scripts: Record<string, string>): void {
  tree.write(`packages/${name}/package.json`, JSON.stringify({ name, scripts }));
}

// endregion | Helpers
