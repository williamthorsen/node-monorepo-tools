import path from 'node:path';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { formatDisplayPath, loadUserConfig, resolveUserConfigPath } from '../user-config.ts';
import { UserError } from '../UserError.ts';

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-user-config-' })),
);

describe(resolveUserConfigPath, () => {
  it('resolves under XDG_CONFIG_HOME when that is an absolute path', () => {
    expect(resolveUserConfigPath({ HOME: '/home/me', XDG_CONFIG_HOME: '/xdg' })).toBe(
      path.join('/xdg', 'nmr', 'config.ts'),
    );
  });

  it.for([
    { scenario: 'is unset', env: { HOME: '/home/me' } },
    { scenario: 'is empty', env: { HOME: '/home/me', XDG_CONFIG_HOME: '' } },
    { scenario: 'is a relative path', env: { HOME: '/home/me', XDG_CONFIG_HOME: 'config' } },
  ])('falls back to HOME when XDG_CONFIG_HOME $scenario', ({ env }) => {
    expect(resolveUserConfigPath(env)).toBe(path.join('/home/me', '.config', 'nmr', 'config.ts'));
  });

  it('returns undefined when the environment names neither directory', () => {
    expect(resolveUserConfigPath({})).toBeUndefined();
  });
});

describe(loadUserConfig, () => {
  it('returns undefined when the file does not exist', async ({ tree }) => {
    await expect(loadUserConfig({ XDG_CONFIG_HOME: tree.dir })).resolves.toBeUndefined();
  });

  it('returns undefined when the environment does not locate a file', async () => {
    await expect(loadUserConfig({})).resolves.toBeUndefined();
  });

  it('loads hosts and when, with the path from which it read them', async ({ tree }) => {
    writeUserConfig(tree, `export default { delegate: { hosts: ['imac2', 'imac3'], when: 'agent' } };`);

    await expect(loadUserConfig({ XDG_CONFIG_HOME: tree.dir })).resolves.toStrictEqual({
      config: { delegate: { hosts: ['imac2', 'imac3'], when: 'agent' } },
      path: path.join(tree.dir, 'nmr', 'config.ts'),
    });
  });

  it('loads hosts without when', async ({ tree }) => {
    writeUserConfig(tree, `export default { delegate: { hosts: ['imac2'] } };`);

    const loaded = await loadUserConfig({ XDG_CONFIG_HOME: tree.dir });

    expect(loaded?.config).toStrictEqual({ delegate: { hosts: ['imac2'] } });
  });

  it('trims host names and drops repeats', async ({ tree }) => {
    writeUserConfig(tree, `export default { delegate: { hosts: [' imac2 ', 'imac3', 'imac2'], when: 'always' } };`);

    const loaded = await loadUserConfig({ XDG_CONFIG_HOME: tree.dir });

    expect(loaded?.config.delegate?.hosts).toStrictEqual(['imac2', 'imac3']);
  });

  it('loads a config that declares nothing', async ({ tree }) => {
    writeUserConfig(tree, `export default {};`);

    const loaded = await loadUserConfig({ XDG_CONFIG_HOME: tree.dir });

    expect(loaded?.config).toStrictEqual({});
  });

  // The CLI boundary reads the class, not the message, to print a config error without a stack trace.
  it('rejects an invalid config as a UserError', async ({ tree }) => {
    writeUserConfig(tree, `export default { delegate: true };`);

    await expect(loadUserConfig({ XDG_CONFIG_HOME: tree.dir })).rejects.toThrow(UserError);
  });

  it.for([
    {
      scenario: 'a default export that is not an object',
      source: `export default 'imac2';`,
      message: 'expected an object, got string',
    },
    {
      scenario: 'an unknown top-level key',
      source: `export default { hosts: ['imac2'] };`,
      message: 'unrecognized key `hosts`. Recognized: `delegate`.',
    },
    {
      scenario: 'a delegate that is not an object',
      source: `export default { delegate: 'imac2' };`,
      message: '`delegate` must be an object',
    },
    {
      scenario: 'an unknown delegate key',
      source: `export default { delegate: { hosts: ['imac2'], mode: 'agent' } };`,
      message: 'unrecognized key `delegate.mode`. Recognized: `delegate.hosts`, `delegate.when`.',
    },
    {
      scenario: 'when without hosts',
      source: `export default { delegate: { when: 'agent' } };`,
      message: '`delegate.hosts` must be a non-empty array of host names',
    },
    {
      scenario: 'hosts that is a string',
      source: `export default { delegate: { hosts: 'imac2' } };`,
      message: '`delegate.hosts` must be a non-empty array of host names',
    },
    {
      scenario: 'an empty hosts',
      source: `export default { delegate: { hosts: [] } };`,
      message: '`delegate.hosts` must be a non-empty array of host names',
    },
    {
      scenario: 'a blank host name',
      source: `export default { delegate: { hosts: ['imac2', ' '] } };`,
      message: '`delegate.hosts` must be a non-empty array of host names',
    },
    {
      scenario: 'a host name that is not a string',
      source: `export default { delegate: { hosts: ['imac2', 3] } };`,
      message: '`delegate.hosts` must be a non-empty array of host names',
    },
    {
      scenario: 'an unknown when',
      source: `export default { delegate: { hosts: ['imac2'], when: 'ci' } };`,
      message: '`delegate.when` is `ci`, which is not one of: agent, always',
    },
  ])('throws naming the file and the key given $scenario', async ({ message, source }, { tree }) => {
    writeUserConfig(tree, source);
    const configPath = path.join(tree.dir, 'nmr', 'config.ts');

    await expect(loadUserConfig({ XDG_CONFIG_HOME: tree.dir })).rejects.toThrow(
      `Invalid nmr config at ${configPath}: ${message}`,
    );
  });
});

describe(formatDisplayPath, () => {
  it('replaces the home directory with ~', () => {
    expect(formatDisplayPath('/home/me/.config/nmr/config.ts', { HOME: '/home/me' })).toBe('~/.config/nmr/config.ts');
  });

  it.for([
    { scenario: 'lies outside the home directory', filePath: '/xdg/nmr/config.ts', env: { HOME: '/home/me' } },
    {
      scenario: 'shares only a prefix with the home directory',
      filePath: '/home/menu/config.ts',
      env: { HOME: '/home/me' },
    },
    { scenario: 'is read without a home directory', filePath: '/home/me/config.ts', env: {} },
  ])('keeps a path that $scenario', ({ env, filePath }) => {
    expect(formatDisplayPath(filePath, env)).toBe(filePath);
  });
});

// region | Helpers

/** Writes a user config into the tree, which each test passes as `XDG_CONFIG_HOME`. */
function writeUserConfig(tree: TempTree, source: string): void {
  tree.write('nmr/config.ts', source);
}

// endregion | Helpers
