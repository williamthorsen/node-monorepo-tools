import { existsSync } from 'node:fs';
import path from 'node:path';

import { isRecord, UserError } from '@williamthorsen/nmr-core';

import { assertRecognizedKeys } from '../config-validation.ts';
import { importConfigDefault } from '../helpers/importConfigDefault.ts';
import { resolveXdgBaseDir } from '../helpers/resolveXdgBaseDir.ts';
import type { HostList } from './remote-run.ts';

/** The values that `delegate.when` accepts, each naming the runs that delegate without being asked. */
const DELEGATE_WHEN_VALUES = ['agent', 'always'] as const;

export type DelegateWhen = (typeof DELEGATE_WHEN_VALUES)[number];

/** The age, in days, past which a delegation removes a host's unused checkouts when the user config does not set one. */
export const DEFAULT_REMOVE_CHECKOUTS_AFTER_DAYS = 7;

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

  const loadedConfig = await importConfigDefault(configPath);

  return { config: validateUserConfig(loadedConfig, configPath), path: configPath };
}

/**
 * Returns the user config's path, resolved from `env` alone so that a caller's environment decides which file is
 * read: under `XDG_CONFIG_HOME` when that is an absolute path, as the XDG base-directory spec requires, otherwise
 * under `HOME`'s `.config`. Returns `undefined` when `env` names neither.
 */
export function resolveUserConfigPath(env: NodeJS.ProcessEnv): string | undefined {
  const configHome = resolveXdgBaseDir(env, 'XDG_CONFIG_HOME', '.config');
  return configHome === undefined ? undefined : path.join(configHome, USER_CONFIG_RELATIVE_PATH);
}

/** The machine-level settings that `$XDG_CONFIG_HOME/nmr/config.ts` declares. */
export interface UserConfig {
  delegate?: UserDelegateConfig;
}

/** This machine's delegation hosts, and which runs delegate to them without being asked. */
export interface UserDelegateConfig {
  hosts: HostList;
  /** The age, in days, past which a delegation removes the host's unused checkouts; `false` keeps them. */
  removeCheckoutsAfterDays?: number | false;
  when?: DelegateWhen;
}

// region | Helpers

const USER_CONFIG_RELATIVE_PATH = path.join('nmr', 'config.ts');

const RECOGNIZED_KEYS = ['delegate'];
const RECOGNIZED_DELEGATE_KEYS = ['hosts', 'removeCheckoutsAfterDays', 'when'];

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
  if (!isRecord(delegate)) {
    throw new UserError(`Invalid nmr config at ${configPath}: \`delegate\` must be an object`);
  }
  assertRecognizedKeys(delegate, RECOGNIZED_DELEGATE_KEYS, configPath, 'delegate.');

  const hosts = validateHosts(delegate['hosts'], configPath);
  const removeCheckoutsAfterDays = validateRemoveCheckoutsAfterDays(delegate['removeCheckoutsAfterDays'], configPath);
  const removal = removeCheckoutsAfterDays === undefined ? {} : { removeCheckoutsAfterDays };

  const when: unknown = delegate['when'];
  if (when === undefined) {
    return { hosts, ...removal };
  }
  if (!isDelegateWhen(when)) {
    const renderedValue = typeof when === 'string' ? when : JSON.stringify(when);
    throw new UserError(
      `Invalid nmr config at ${configPath}: \`delegate.when\` is \`${renderedValue}\`, which is not one of: ` +
        DELEGATE_WHEN_VALUES.join(', '),
    );
  }

  return { hosts, ...removal, when };
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

/** Validates `delegate.removeCheckoutsAfterDays`: a positive, finite number of days, or `false`. */
function validateRemoveCheckoutsAfterDays(value: unknown, configPath: string): number | false | undefined {
  if (value === undefined || value === false || (typeof value === 'number' && Number.isFinite(value) && value > 0)) {
    return value;
  }

  throw new UserError(
    `Invalid nmr config at ${configPath}: \`delegate.removeCheckoutsAfterDays\` must be a positive number of days, ` +
      'or `false` to keep every checkout',
  );
}

/** Validates that a loaded value conforms to the `UserConfig` shape. */
function validateUserConfig(value: unknown, configPath: string): UserConfig {
  if (!isRecord(value)) {
    throw new UserError(`Invalid nmr config at ${configPath}: expected an object, got ${typeof value}`);
  }
  assertRecognizedKeys(value, RECOGNIZED_KEYS, configPath);

  const delegate = validateDelegateField(value, configPath);

  return delegate === undefined ? {} : { delegate };
}

// endregion | Helpers
