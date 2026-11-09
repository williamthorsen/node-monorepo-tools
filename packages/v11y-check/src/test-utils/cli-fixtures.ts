import { type Mock, vi } from 'vitest';

import type { CommandDependencies } from '../commands.ts';
import type { ConfigSource, LoadConfigResult } from '../config.ts';
import type { CommandOptions, V11yCheckConfig } from '../types.ts';

/** The command dependencies as mocks, which a test primes and inspects. */
export type FakeCommandDependencies = { [Key in keyof CommandDependencies]: Mock<CommandDependencies[Key]> };

/**
 * Builds mock command dependencies that use a fake temp directory, write the audit-ci config to a fake path, and
 * scaffold a config successfully, with any given fakes in place of the defaults.
 */
export function buildFakeCommandDependencies(overrides?: Partial<FakeCommandDependencies>): FakeCommandDependencies {
  return {
    generateAuditCiConfig: vi
      .fn<CommandDependencies['generateAuditCiConfig']>()
      .mockResolvedValue('/fake/tmp/audit-ci.json'),
    loadConfig: vi.fn<CommandDependencies['loadConfig']>(),
    runAudit: vi.fn<CommandDependencies['runAudit']>(),
    runReport: vi.fn<CommandDependencies['runReport']>(),
    scaffoldConfig: vi
      .fn<CommandDependencies['scaffoldConfig']>()
      .mockReturnValue({ configResult: { filePath: '.config/v11y-check.config.json', outcome: 'created' } }),
    syncAllowlist: vi.fn<CommandDependencies['syncAllowlist']>(),
    withTempDir: vi.fn<CommandDependencies['withTempDir']>().mockImplementation(callWithFakeTempDir),
    ...overrides,
  };
}

/** Builds the result of loading the config, or `makeConfig()` when none is given, from a fake config directory. */
export function buildLoadConfigResult(config?: V11yCheckConfig, source: ConfigSource = 'file'): LoadConfigResult {
  return {
    config: config ?? makeConfig(),
    configDir: '/fake/dir',
    configFilePath: '/fake/dir/v11y-check.config.json',
    configSource: source,
  };
}

/** Calls the callback with a fake temp-directory path, standing in for `withTempDir`. */
export async function callWithFakeTempDir<T>(callback: (dir: string) => Promise<T>): Promise<T> {
  return callback('/fake/tmp');
}

/** Builds a config with an empty allowlist in each scope, merged with the overrides. */
export function makeConfig(overrides?: Partial<V11yCheckConfig>): V11yCheckConfig {
  return {
    dev: { allowlist: [] },
    prod: { allowlist: [] },
    ...overrides,
  };
}

/** Builds the options of a rich-text, non-verbose command run over the default scopes, merged with the overrides. */
export function makeOptions(overrides?: Partial<CommandOptions>): CommandOptions {
  return { isJson: false, scopes: [], styles: { stderr: 'rich', stdout: 'rich' }, verbose: false, ...overrides };
}
