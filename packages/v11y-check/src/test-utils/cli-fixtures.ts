import type { ConfigSource, LoadConfigResult } from '../config.ts';
import type { CommandOptions, V11yCheckConfig } from '../types.ts';

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
export async function callWithFakeTempDir(callback: (dir: string) => Promise<unknown>): Promise<unknown> {
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
