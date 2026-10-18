import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { assertRecognizedKeys } from './config-validation.ts';
import { isObject } from './helpers/type-guards.ts';
import type { HostList } from './remote-run.ts';
import { UserError } from './UserError.ts';

/** The values that `delegate.when` accepts, each naming the runs that delegate without being asked. */
export const DELEGATE_WHEN_VALUES = ['agent', 'always'] as const;

export type DelegateWhen = (typeof DELEGATE_WHEN_VALUES)[number];

/**
 * Renders a path for a message, with `~` standing for the home directory that `env` names when the path lies under
 * it.
 */
export function formatDisplayPath(filePath: string, env: NodeJS.ProcessEnv): string {
  const home = env['HOME'];
  if (home === undefined || !path.isAbsolute(home)) {
    return filePath;
  }

  const relativePath = path.relative(home, filePath);
  if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return filePath;
  }

  return path.join('~', relativePath);
}

/** A user config, with the path from which it was loaded. */
export interface LoadedUserConfig {
  config: UserConfig;
  path: string;
}

/**
 * Loads and validates the user config that `env` locates, or returns `undefined` when `env` locates none or the file
 * does not exist.
 */
export async function loadUserConfig(env: NodeJS.ProcessEnv): Promise<LoadedUserConfig | undefined> {
  const configPath = resolveUserConfigPath(env);
  if (configPath === undefined || !existsSync(configPath)) {
    return undefined;
  }

  const importedModule: unknown = await import(pathToFileURL(configPath).href);
  const loadedConfig = isObject(importedModule) ? importedModule['default'] : undefined;

  return { config: validateUserConfig(loadedConfig, configPath), path: configPath };
}

/**
 * Returns the user config's path, resolved from `env` alone so that a caller's environment decides which file is
 * read: under `XDG_CONFIG_HOME` when that is an absolute path, as the XDG base-directory spec requires, otherwise
 * under `HOME`'s `.config`. Returns `undefined` when `env` names neither.
 */
export function resolveUserConfigPath(env: NodeJS.ProcessEnv): string | undefined {
  const configHome = env['XDG_CONFIG_HOME'];
  if (configHome !== undefined && path.isAbsolute(configHome)) {
    return path.join(configHome, USER_CONFIG_RELATIVE_PATH);
  }

  const home = env['HOME'];
  if (home !== undefined && path.isAbsolute(home)) {
    return path.join(home, '.config', USER_CONFIG_RELATIVE_PATH);
  }

  return undefined;
}

/** The machine-level settings that `$XDG_CONFIG_HOME/nmr/config.ts` declares. */
export interface UserConfig {
  delegate?: UserDelegateConfig;
}

/** This machine's delegation hosts, and which runs delegate to them without being asked. */
export interface UserDelegateConfig {
  hosts: HostList;
  when?: DelegateWhen;
}

// region | Helpers

const USER_CONFIG_RELATIVE_PATH = path.join('nmr', 'config.ts');

const RECOGNIZED_KEYS = ['delegate'];
const RECOGNIZED_DELEGATE_KEYS = ['hosts', 'when'];

/** Narrows a raw value to one of the values that `delegate.when` accepts. */
function isDelegateWhen(value: unknown): value is DelegateWhen {
  const values: readonly unknown[] = DELEGATE_WHEN_VALUES;
  return values.includes(value);
}

/** Validates and extracts the `delegate` field from the raw user config. */
function validateDelegateField(value: Record<string, unknown>, configPath: string): UserDelegateConfig | undefined {
  const delegate: unknown = value['delegate'];
  if (delegate === undefined) {
    return undefined;
  }
  if (!isObject(delegate)) {
    throw new UserError(`Invalid nmr config at ${configPath}: \`delegate\` must be an object`);
  }
  assertRecognizedKeys(delegate, RECOGNIZED_DELEGATE_KEYS, configPath, 'delegate.');

  const hosts = validateHosts(delegate['hosts'], configPath);

  const when: unknown = delegate['when'];
  if (when === undefined) {
    return { hosts };
  }
  if (!isDelegateWhen(when)) {
    const renderedValue = typeof when === 'string' ? when : JSON.stringify(when);
    throw new UserError(
      `Invalid nmr config at ${configPath}: \`delegate.when\` is \`${renderedValue}\`, which is not one of: ` +
        DELEGATE_WHEN_VALUES.join(', '),
    );
  }

  return { hosts, when };
}

/**
 * Validates `delegate.hosts` and returns its names trimmed and without repeats, as `NMR_DELEGATE`'s are. Required
 * whenever `delegate` is present: Without a host, `when` would turn on a delegation that has nowhere to go.
 */
function validateHosts(value: unknown, configPath: string): HostList {
  const names =
    Array.isArray(value) && value.every((host) => typeof host === 'string')
      ? value.map((host: string) => host.trim())
      : [];
  const [first, ...rest] = new Set(names);
  if (first === undefined || names.includes('')) {
    throw new UserError(
      `Invalid nmr config at ${configPath}: \`delegate.hosts\` must be a non-empty array of host names, ` +
        'in order of preference',
    );
  }

  return [first, ...rest];
}

/** Validates that a loaded value conforms to the `UserConfig` shape. */
function validateUserConfig(value: unknown, configPath: string): UserConfig {
  if (!isObject(value)) {
    throw new UserError(`Invalid nmr config at ${configPath}: expected an object, got ${typeof value}`);
  }
  assertRecognizedKeys(value, RECOGNIZED_KEYS, configPath);

  const delegate = validateDelegateField(value, configPath);

  return delegate === undefined ? {} : { delegate };
}

// endregion | Helpers
