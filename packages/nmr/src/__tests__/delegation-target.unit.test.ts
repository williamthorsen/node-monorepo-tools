import { describe, expect, it, vi } from 'vitest';

import { resolveDelegationTarget } from '../delegation-target.ts';
import { DELEGATE_ENV_VAR } from '../remote-run.ts';
import type { LoadedUserConfig, UserConfig } from '../user-config.ts';
import { UserError } from '../UserError.ts';

const USER_CONFIG_PATH = '/home/me/.config/nmr/config.ts';

const AGENT_CONFIG: UserConfig = { delegate: { hosts: ['imac2', 'imac3'], when: 'agent' } };
const ALWAYS_CONFIG: UserConfig = { delegate: { hosts: ['imac2', 'imac3'], when: 'always' } };
const HOSTS_ONLY_CONFIG: UserConfig = { delegate: { hosts: ['imac2'] } };
const LOADED_ALWAYS: LoadedUserConfig = { config: ALWAYS_CONFIG, path: USER_CONFIG_PATH };

describe(resolveDelegationTarget, () => {
  describe('rule 1: --no-delegate', () => {
    it.for([
      { case: '--delegate-to', flagValue: 'box' },
      { case: '--delegate', envValue: 'box', shouldDelegate: true },
      { case: 'NMR_DELEGATE', envValue: 'box' },
      { case: 'the user config', userConfig: ALWAYS_CONFIG },
    ])('runs here over $case', async (overrides) => {
      await expect(resolve({ ...overrides, isOptedOut: true })).resolves.toStrictEqual({ kind: 'local' });
    });
  });

  describe('rule 2: --delegate and --delegate-to', () => {
    it.for([
      { case: '--delegate-to', flagValue: 'box,spare', expected: ['box', 'spare'] },
      { case: '--delegate-to over NMR_DELEGATE', envValue: 'other', flagValue: 'box', expected: ['box'] },
      { case: '--delegate-to with --delegate', flagValue: 'box', shouldDelegate: true, expected: ['box'] },
      { case: "--delegate with NMR_DELEGATE's hosts", envValue: 'box', shouldDelegate: true, expected: ['box'] },
      {
        case: "--delegate with the user config's hosts",
        shouldDelegate: true,
        userConfig: HOSTS_ONLY_CONFIG,
        expected: ['imac2'],
      },
      {
        case: '--delegate past an empty NMR_DELEGATE',
        envValue: '',
        shouldDelegate: true,
        userConfig: HOSTS_ONLY_CONFIG,
        expected: ['imac2'],
      },
      { case: 'a flag over a repo opt-out', flagValue: 'box', isRepoOptedOut: true, expected: ['box'] },
      { case: 'a flag in CI', env: { CI: 'true' }, flagValue: 'box', expected: ['box'] },
      { case: 'a flag on a fan-out', flagValue: 'box', isFanOut: true, expected: ['box'] },
    ])('delegates for $case', async ({ expected, ...overrides }) => {
      await expect(resolve(overrides)).resolves.toStrictEqual({ kind: 'remote', hosts: expected, source: 'flag' });
    });

    it('trims, drops empty entries from, and deduplicates a host list', async () => {
      await expect(resolve({ flagValue: ' box , ,spare,box,' })).resolves.toStrictEqual({
        kind: 'remote',
        hosts: ['box', 'spare'],
        source: 'flag',
      });
    });

    it('refuses a --delegate-to value that does not name a host', async () => {
      await expect(resolve({ flagValue: ' , ' })).resolves.toStrictEqual({
        kind: 'refused',
        error: '--delegate-to requires a host: " , " does not name a host.',
      });
    });

    it('refuses bare --delegate when neither NMR_DELEGATE nor the user config names a host', async () => {
      await expect(resolve({ env: { HOME: '/home/me' }, shouldDelegate: true, userConfig: {} })).resolves.toStrictEqual(
        {
          kind: 'refused',
          error:
            '--delegate needs hosts: set `delegate.hosts` in ~/.config/nmr/config.ts, or name them with ' +
            '--delegate-to <host,...>.',
        },
      );
    });

    it.for(['build', 'clean', 'compile', 'fix', 'fmt', 'lint', 'test:watch', 'upgrade', 'root:fmt', 'root:test:watch'])(
      'refuses `%s`',
      async (command) => {
        await expect(resolve({ command, flagValue: 'box' })).resolves.toStrictEqual({
          kind: 'refused',
          error: `\`${command}\` cannot be delegated: it rewrites the working tree or runs until stopped. Run it without --delegate-to.`,
        });
      },
    );

    it('refuses --log, naming the flag that asked', async () => {
      await expect(resolve({ envValue: 'box', isReading: true, shouldDelegate: true })).resolves.toStrictEqual({
        kind: 'refused',
        error: "--log cannot be delegated: it reads this machine's recordings. Run it without --delegate.",
      });
    });

    it('does not read the user config when a flag or NMR_DELEGATE names the hosts', async () => {
      const readUserConfig = vi.fn(() => Promise.resolve(LOADED_ALWAYS));

      await resolve({ flagValue: 'box', readUserConfig });
      await resolve({ envValue: 'box', readUserConfig, shouldDelegate: true });

      expect(readUserConfig).not.toHaveBeenCalled();
    });
  });

  describe('rule 3: the repo opts out', () => {
    it.for([
      { case: 'NMR_DELEGATE', envValue: 'box' },
      { case: 'the user config', userConfig: ALWAYS_CONFIG },
    ])('runs here over $case', async (overrides) => {
      await expect(resolve({ ...overrides, isRepoOptedOut: true })).resolves.toStrictEqual({ kind: 'local' });
    });
  });

  describe('rule 4: NMR_DELEGATE names hosts', () => {
    it('delegates to its hosts over the user config', async () => {
      await expect(resolve({ envValue: 'box,spare', userConfig: ALWAYS_CONFIG })).resolves.toStrictEqual({
        kind: 'remote',
        hosts: ['box', 'spare'],
        source: 'env',
      });
    });

    it.for([
      { case: 'a fan-out', isFanOut: true },
      { case: 'CI', env: { CI: 'true' } },
      { case: 'a custom script', command: 'test:e2e' },
    ])('delegates $case', async (overrides) => {
      await expect(resolve({ ...overrides, envValue: 'box' })).resolves.toStrictEqual({
        kind: 'remote',
        hosts: ['box'],
        source: 'env',
      });
    });

    it.for([
      { case: 'a tree-rewriting command', command: 'fmt' },
      { case: '--log', isReading: true },
    ])('runs $case here', async (overrides) => {
      await expect(resolve({ ...overrides, envValue: 'box' })).resolves.toStrictEqual({ kind: 'local' });
    });
  });

  describe('rule 5: NMR_DELEGATE is set without a host', () => {
    it.for(['', ' , '])('runs here over the user config when the variable is %j', async (envValue) => {
      const readUserConfig = vi.fn(() => Promise.resolve(LOADED_ALWAYS));

      await expect(resolve({ envValue, readUserConfig })).resolves.toStrictEqual({ kind: 'local' });
      expect(readUserConfig).not.toHaveBeenCalled();
    });
  });

  describe("rule 6: the user config's when matches", () => {
    it('delegates every run under when: always', async () => {
      await expect(resolve({ userConfig: ALWAYS_CONFIG })).resolves.toStrictEqual({
        kind: 'remote',
        hosts: ['imac2', 'imac3'],
        source: 'config',
        configPath: USER_CONFIG_PATH,
        when: 'always',
      });
    });

    it('delegates an agent run under when: agent', async () => {
      await expect(resolve({ env: { CLAUDECODE: '1' }, userConfig: AGENT_CONFIG })).resolves.toStrictEqual({
        kind: 'remote',
        hosts: ['imac2', 'imac3'],
        source: 'config',
        configPath: USER_CONFIG_PATH,
        when: 'agent',
      });
    });

    it("recognizes an agent by the repo's extraAgentEnvVars", async () => {
      const target = await resolve({
        env: { MY_AGENT: '1' },
        extraAgentEnvVars: ['MY_AGENT'],
        userConfig: AGENT_CONFIG,
      });

      expect(target).toMatchObject({ kind: 'remote', source: 'config' });
    });

    it.for([
      { case: 'when: agent meets a run without an agent marker', userConfig: AGENT_CONFIG },
      { case: 'when: agent meets an empty agent marker', env: { CLAUDECODE: '' }, userConfig: AGENT_CONFIG },
      { case: 'the config does not declare when', userConfig: HOSTS_ONLY_CONFIG },
      { case: 'the config does not declare delegate', userConfig: {} },
      { case: 'the user config does not exist', userConfig: undefined },
      { case: 'CI is set', env: { CI: 'true' }, userConfig: ALWAYS_CONFIG },
      { case: 'the invocation fans out', isFanOut: true, userConfig: ALWAYS_CONFIG },
      { case: 'the command rewrites the tree', command: 'fmt', userConfig: ALWAYS_CONFIG },
      { case: 'the command is --log', isReading: true, userConfig: ALWAYS_CONFIG },
    ])('runs here when $case', async (overrides) => {
      await expect(resolve(overrides)).resolves.toStrictEqual({ kind: 'local' });
    });

    it('runs here in CI with an empty CI value read as unset', async () => {
      const target = await resolve({ env: { CI: '' }, userConfig: ALWAYS_CONFIG });

      expect(target).toMatchObject({ kind: 'remote', source: 'config' });
    });

    it('propagates an invalid user config to a run that reaches the rule', async () => {
      const readUserConfig = vi.fn(() => Promise.reject(new UserError('Invalid nmr config')));

      await expect(resolve({ readUserConfig })).rejects.toThrow('Invalid nmr config');
    });

    it.for([
      { case: '--no-delegate', isOptedOut: true },
      { case: '--delegate-to', flagValue: 'box' },
      { case: 'a repo opt-out', isRepoOptedOut: true },
      { case: 'NMR_DELEGATE', envValue: 'box' },
      { case: 'an empty NMR_DELEGATE', envValue: '' },
      { case: 'CI', env: { CI: 'true' } },
      { case: 'a fan-out', isFanOut: true },
      { case: 'a tree-rewriting command', command: 'fmt' },
    ])('does not read the user config under $case', async (overrides) => {
      const readUserConfig = vi.fn(() => Promise.reject(new UserError('Invalid nmr config')));

      await expect(resolve({ ...overrides, readUserConfig })).resolves.not.toHaveProperty('kind', 'refused');
      expect(readUserConfig).not.toHaveBeenCalled();
    });
  });

  it('runs here when nothing asks for a host', async () => {
    await expect(resolve({})).resolves.toStrictEqual({ kind: 'local' });
  });
});

// region | Helpers

/**
 * Resolves with defaults for every input that a case leaves out: a delegable command, an environment without any of
 * the variables that the rules read, and no user config. `envValue` sets `NMR_DELEGATE`, and `userConfig` stands in
 * for a file at `USER_CONFIG_PATH`.
 */
function resolve(
  overrides: Partial<Parameters<typeof resolveDelegationTarget>[0]> & {
    envValue?: string;
    userConfig?: UserConfig | undefined;
  },
): ReturnType<typeof resolveDelegationTarget> {
  const { env = {}, envValue, userConfig, ...rest } = overrides;
  const loaded = userConfig === undefined ? undefined : { config: userConfig, path: USER_CONFIG_PATH };

  return resolveDelegationTarget({
    command: 'ci',
    env: envValue === undefined ? env : { ...env, [DELEGATE_ENV_VAR]: envValue },
    extraAgentEnvVars: undefined,
    flagValue: undefined,
    isFanOut: false,
    isOptedOut: false,
    isReading: false,
    isRepoOptedOut: false,
    readUserConfig: () => Promise.resolve(loaded),
    shouldDelegate: false,
    ...rest,
  });
}

// endregion | Helpers
