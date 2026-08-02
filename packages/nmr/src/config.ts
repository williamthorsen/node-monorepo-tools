import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { isObject } from './helpers/type-guards.ts';

/** Build settings honored by `nmr-compile`. */
export interface BuildConfig {
  /**
   * Patterns added to the build's default ignore set. Extends rather than replaces, so declaring one pattern
   * cannot silently drop the defaults and start shipping a package's own tests. The programmatic
   * `buildPackage` option of the same name behaves identically; its bare `ignore` is what replaces.
   */
  extendIgnore?: string[];
}

export interface NmrConfig {
  build?: BuildConfig;
  devBin?: Record<string, string>;
  workspaceScripts?: Record<string, string | string[]>;
  rootScripts?: Record<string, string | string[]>;
}

const CONFIG_FILENAME = 'nmr.config.ts';
const CONFIG_DIR = '.config';

/** Keys a package's own config file may declare. Everything else belongs to the monorepo-root config. */
const WORKSPACE_CONFIG_KEYS = ['build'];

/**
 * Type-safe identity function for configuration files.
 *
 * Usage in `.config/nmr.config.ts`:
 * ```ts
 * import { defineConfig } from '@williamthorsen/nmr';
 * export default defineConfig({ ... });
 * ```
 */
export function defineConfig(config: NmrConfig): NmrConfig {
  return config;
}

/** Narrow an unknown value to a record of script entries. */
function isScriptRecord(value: unknown): value is Record<string, string | string[]> {
  if (!isObject(value)) return false;
  for (const v of Object.values(value)) {
    if (typeof v !== 'string' && !Array.isArray(v)) return false;
    if (Array.isArray(v) && v.some((item) => typeof item !== 'string')) return false;
  }
  return true;
}

/** Validate and extract a single script-record field from the raw config object. */
function validateScriptField(
  value: Record<string, unknown>,
  fieldName: string,
  configPath: string,
): Record<string, string | string[]> | undefined {
  if (!(fieldName in value) || value[fieldName] === undefined) {
    return undefined;
  }
  if (!isScriptRecord(value[fieldName])) {
    throw new Error(
      `Invalid nmr config at ${configPath}: \`${fieldName}\` must be a Record<string, string | string[]>`,
    );
  }
  return value[fieldName];
}

/** Narrow an unknown value to an array of plain strings. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Validate and extract the `build` field from the raw config object. */
function validateBuildField(value: Record<string, unknown>, configPath: string): BuildConfig | undefined {
  const build: unknown = value.build;
  if (build === undefined) {
    return undefined;
  }
  if (!isObject(build)) {
    throw new Error(`Invalid nmr config at ${configPath}: \`build\` must be an object`);
  }

  const extendIgnore: unknown = build.extendIgnore;
  if (extendIgnore !== undefined && !isStringArray(extendIgnore)) {
    throw new Error(`Invalid nmr config at ${configPath}: \`build.extendIgnore\` must be a string[]`);
  }

  return extendIgnore === undefined ? {} : { extendIgnore };
}

/** Narrow an unknown value to a record of plain strings. */
function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isObject(value)) return false;
  for (const v of Object.values(value)) {
    if (typeof v !== 'string') return false;
  }
  return true;
}

/** Validate and extract a `Record<string, string>` field from the raw config object. */
function validateStringRecordField(
  value: Record<string, unknown>,
  fieldName: string,
  configPath: string,
): Record<string, string> | undefined {
  if (!(fieldName in value) || value[fieldName] === undefined) {
    return undefined;
  }
  if (!isStringRecord(value[fieldName])) {
    throw new Error(`Invalid nmr config at ${configPath}: \`${fieldName}\` must be a Record<string, string>`);
  }
  return value[fieldName];
}

/** Validate that a loaded value conforms to the expected `NmrConfig` shape. */
function validateConfig(value: unknown, configPath: string): NmrConfig {
  if (!isObject(value)) {
    throw new Error(`Invalid nmr config at ${configPath}: expected an object, got ${typeof value}`);
  }

  const config: NmrConfig = {};

  const build = validateBuildField(value, configPath);
  if (build) config.build = build;

  const devBin = validateStringRecordField(value, 'devBin', configPath);
  if (devBin) config.devBin = devBin;

  const workspaceScripts = validateScriptField(value, 'workspaceScripts', configPath);
  if (workspaceScripts) config.workspaceScripts = workspaceScripts;

  const rootScripts = validateScriptField(value, 'rootScripts', configPath);
  if (rootScripts) config.rootScripts = rootScripts;

  return config;
}

/**
 * Loads the nmr configuration from `.config/nmr.config.ts` under `baseDir`, which is the monorepo root for
 * the repo-wide config and a package directory for the workspace tier. Returns an empty config if the file
 * doesn't exist.
 */
export async function loadConfig(baseDir: string): Promise<NmrConfig> {
  const configPath = path.join(baseDir, CONFIG_DIR, CONFIG_FILENAME);

  if (!existsSync(configPath)) {
    return {};
  }

  // Node type-strips `.ts` natively at this package's engines floor, so the config needs no transform step
  // and no loader dependency. `import()` takes a URL, not a path: a bare Windows path parses as a scheme.
  const imported: { default?: unknown } = await import(pathToFileURL(configPath).href);

  return validateConfig(imported.default, configPath);
}

/**
 * Loads a single package's `.config/nmr.config.ts`, the tier `nmr-compile` reads from its working directory.
 * Returns an empty config if the file doesn't exist.
 *
 * Throws on a recognized key this tier does not honor. Dropping one would leave a package building on
 * settings its own config file appears to change, which nothing in the build's output would reveal.
 */
export async function loadWorkspaceConfig(packageDir: string): Promise<NmrConfig> {
  const config = await loadConfig(packageDir);
  const unsupported = Object.keys(config).filter((key) => !WORKSPACE_CONFIG_KEYS.includes(key));

  if (unsupported.length > 0) {
    const configPath = path.join(packageDir, CONFIG_DIR, CONFIG_FILENAME);
    throw new Error(
      `Invalid nmr config at ${configPath}: a package config honors ${WORKSPACE_CONFIG_KEYS.join(', ')} alone, ` +
        `not ${unsupported.toSorted().join(', ')}. Move those keys to the monorepo-root config.`,
    );
  }

  return config;
}
