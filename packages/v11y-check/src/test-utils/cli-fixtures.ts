import type { CommandOptions, V11yCheckConfig } from '../types.ts';

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
  return { json: false, scopes: [], styles: { stderr: 'rich', stdout: 'rich' }, verbose: false, ...overrides };
}
