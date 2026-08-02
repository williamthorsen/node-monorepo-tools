import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { isObject } from './helpers/type-guards.ts';

/** Build settings honored by `nmr-compile`. */
export interface BuildConfig {
  /**
   * Patterns added to the build's default ignore set. Extends rather than replaces, so that declaring one pattern
   * cannot silently drop the defaults and start shipping a package's own tests.
   * The programmatic `buildPackage` option of the same name behaves identically; its bare `ignorePatterns` replaces.
   */
  extraIgnorePatterns?: string[];
}

export interface NmrConfig {
  build?: BuildConfig;
  devBin?: Record<string, string>;
  workspaceScripts?: Record<string, string | string[]>;
  rootScripts?: Record<string, string | string[]>;
}

const CONFIG_FILENAME = 'nmr.config.ts';
const CONFIG_DIR = '.config';

interface ConfigTier {
  /** Names the tier in an error message. */
  label: string;
  honoredKeys: string[];
  /** Names where a key this tier does not honor belongs. */
  elsewhere: string;
}

/**
 * The keys each tier honors, and where the other tier's belong. Every recognized key sits in exactly one tier,
 * so `RECOGNIZED_KEYS` derives from these rather than repeating them and cannot fall out of step with them.
 */
const CONFIG_TIERS: Record<'root' | 'workspace', ConfigTier> = {
  root: {
    label: 'a monorepo-root config',
    honoredKeys: ['devBin', 'rootScripts', 'workspaceScripts'],
    elsewhere: "the package's own config",
  },
  workspace: {
    label: 'a package config',
    honoredKeys: ['build'],
    elsewhere: 'the monorepo-root config',
  },
};

const RECOGNIZED_KEYS = [...CONFIG_TIERS.root.honoredKeys, ...CONFIG_TIERS.workspace.honoredKeys];
const RECOGNIZED_BUILD_KEYS = ['extraIgnorePatterns'];

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

/**
 * Resolves the config-file path for a directory, whether that is the monorepo root or a package.
 * Callers that only need to know whether a config exists -- the build, which folds it into its cache digest -- go
 * through this rather than spelling the path again, so that the two cannot drift into hashing a file nothing reads.
 */
export function resolveConfigPath(baseDir: string): string {
  return path.join(baseDir, CONFIG_DIR, CONFIG_FILENAME);
}

/** Narrows an unknown value to a record of script entries. */
function isScriptRecord(value: unknown): value is Record<string, string | string[]> {
  if (!isObject(value)) return false;
  for (const v of Object.values(value)) {
    if (typeof v !== 'string' && !Array.isArray(v)) return false;
    if (Array.isArray(v) && v.some((item) => typeof item !== 'string')) return false;
  }
  return true;
}

/** Validates and extracts a single script-record field from the raw config object. */
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

/** Narrows an unknown value to an array of plain strings. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Validates and extracts the `build` field from the raw config object. */
function validateBuildField(value: Record<string, unknown>, configPath: string): BuildConfig | undefined {
  const build: unknown = value.build;
  if (build === undefined) {
    return undefined;
  }
  if (!isObject(build)) {
    throw new Error(`Invalid nmr config at ${configPath}: \`build\` must be an object`);
  }
  assertRecognizedKeys(build, RECOGNIZED_BUILD_KEYS, configPath, 'build.');

  const extraIgnorePatterns: unknown = build.extraIgnorePatterns;
  if (extraIgnorePatterns !== undefined && !isStringArray(extraIgnorePatterns)) {
    throw new Error(`Invalid nmr config at ${configPath}: \`build.extraIgnorePatterns\` must be a string[]`);
  }

  return extraIgnorePatterns === undefined ? {} : { extraIgnorePatterns };
}

/** Narrows an unknown value to a record of plain strings. */
function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isObject(value)) return false;
  for (const v of Object.values(value)) {
    if (typeof v !== 'string') return false;
  }
  return true;
}

/** Validates and extracts a `Record<string, string>` field from the raw config object. */
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

/** Validates that a loaded value conforms to the expected `NmrConfig` shape. */
function validateConfig(value: unknown, configPath: string): NmrConfig {
  if (!isObject(value)) {
    throw new Error(`Invalid nmr config at ${configPath}: expected an object, got ${typeof value}`);
  }
  assertRecognizedKeys(value, RECOGNIZED_KEYS, configPath);

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
  const configPath = resolveConfigPath(baseDir);

  if (!existsSync(configPath)) {
    return {};
  }

  // Node type-strips `.ts` natively at this package's engines floor, so the config needs no transform step
  // and no loader dependency. `import()` takes a URL, not a path: A bare Windows path parses as a scheme.
  const imported: unknown = await import(pathToFileURL(configPath).href);
  const loaded = isObject(imported) ? imported.default : undefined;

  return validateConfig(loaded, configPath);
}

/**
 * Loads the monorepo-root `.config/nmr.config.ts`, the tier that feeds script resolution and `devBin`.
 * Returns an empty config if the file doesn't exist.
 *
 * Throws on a recognized key this tier does not honor. `build` governs one package's compile, which reads the
 * package's own config alone, so a `build` accepted here would apply its patterns nowhere.
 */
export async function loadRootConfig(monorepoRoot: string): Promise<NmrConfig> {
  const config = await loadConfig(monorepoRoot);
  assertTierKeys(config, CONFIG_TIERS.root, resolveConfigPath(monorepoRoot));

  return config;
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
  assertTierKeys(config, CONFIG_TIERS.workspace, resolveConfigPath(packageDir));

  return config;
}

/**
 * Throws on any key outside the recognized set, naming the offenders and the file. An unrecognized key is a
 * typo or a stale spelling, and the setting it appears to make is one nothing reads.
 */
function assertRecognizedKeys(
  value: Record<string, unknown>,
  recognizedKeys: string[],
  configPath: string,
  prefix = '',
): void {
  const unrecognized = Object.keys(value).filter((key) => !recognizedKeys.includes(key));
  if (unrecognized.length === 0) {
    return;
  }

  throw new Error(
    `Invalid nmr config at ${configPath}: unrecognized ${unrecognized.length === 1 ? 'key' : 'keys'} ` +
      `${formatKeyList(unrecognized, prefix)}. Recognized: ${formatKeyList(recognizedKeys, prefix)}.`,
  );
}

/**
 * Throws when a config declares a recognized key belonging to the other tier, naming the offenders and where
 * they go. Each tier loads the same file shape, so only the loader can tell a key apart from one it honors.
 */
function assertTierKeys(config: NmrConfig, tier: ConfigTier, configPath: string): void {
  const unsupported = Object.keys(config).filter((key) => !tier.honoredKeys.includes(key));
  if (unsupported.length === 0) {
    return;
  }

  throw new Error(
    `Invalid nmr config at ${configPath}: ${tier.label} honors ${tier.honoredKeys.toSorted().join(', ')} alone, ` +
      `not ${unsupported.toSorted().join(', ')}. Move those keys to ${tier.elsewhere}.`,
  );
}

/** Renders config keys as a sorted, backtick-quoted list, each carrying the prefix of the field holding them. */
function formatKeyList(keys: string[], prefix: string): string {
  return keys
    .toSorted()
    .map((key) => `\`${prefix}${key}\``)
    .join(', ');
}
