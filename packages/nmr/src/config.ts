import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { isObject, isStringRecord } from './helpers/type-guards.ts';
import { findUnexpressibleToken } from './steps.ts';
import type { BuildConfig, CheckCacheConfig, NmrConfig } from './types.ts';

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
    honoredKeys: ['checkCache', 'devBin', 'rootScripts', 'workspaceScripts'],
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
const RECOGNIZED_CHECK_CACHE_KEYS = ['enabled', 'excludeCommands', 'extraCommands'];

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
  if (!Object.hasOwn(value, fieldName) || value[fieldName] === undefined) {
    return undefined;
  }
  const scripts = value[fieldName];
  if (!isScriptRecord(scripts)) {
    throw new Error(
      `Invalid nmr config at ${configPath}: \`${fieldName}\` must be a Record<string, string | string[]>`,
    );
  }
  assertExpressibleElements(scripts, fieldName, configPath);
  return scripts;
}

/**
 * Rejects a composite element outside the grammar: a command name optionally preceded by nmr's own flags.
 * An element carrying a quoted argument or shell syntax renders as one quoted token, so accepting it would
 * run a command nobody wrote.
 */
function assertExpressibleElements(
  scripts: Record<string, string | string[]>,
  fieldName: string,
  configPath: string,
): void {
  for (const [command, script] of Object.entries(scripts)) {
    if (typeof script === 'string') continue;

    for (const element of script) {
      const token = findUnexpressibleToken(element);
      if (token === undefined) continue;

      throw new Error(
        `Invalid nmr config at ${configPath}: \`${fieldName}.${command}\` element \`${element}\` carries ` +
          `\`${token}\`, which is neither a command name nor an nmr flag. Name it as a script of its own and ` +
          `reference that name here.`,
      );
    }
  }
}

/** Narrows an unknown value to an array of plain strings. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Validates and extracts the `build` field from the raw config object. */
function validateBuildField(value: Record<string, unknown>, configPath: string): BuildConfig | undefined {
  const build: unknown = value['build'];
  if (build === undefined) {
    return undefined;
  }
  if (!isObject(build)) {
    throw new Error(`Invalid nmr config at ${configPath}: \`build\` must be an object`);
  }
  assertRecognizedKeys(build, RECOGNIZED_BUILD_KEYS, configPath, 'build.');

  const extraIgnorePatterns: unknown = build['extraIgnorePatterns'];
  if (extraIgnorePatterns !== undefined && !isStringArray(extraIgnorePatterns)) {
    throw new Error(`Invalid nmr config at ${configPath}: \`build.extraIgnorePatterns\` must be a string[]`);
  }

  return extraIgnorePatterns === undefined ? {} : { extraIgnorePatterns };
}

/** Validates and extracts the `checkCache` field from the raw config object. */
function validateCheckCacheField(value: Record<string, unknown>, configPath: string): CheckCacheConfig | undefined {
  const checkCache: unknown = value['checkCache'];
  if (checkCache === undefined) {
    return undefined;
  }
  if (!isObject(checkCache)) {
    throw new Error(`Invalid nmr config at ${configPath}: \`checkCache\` must be an object`);
  }
  assertRecognizedKeys(checkCache, RECOGNIZED_CHECK_CACHE_KEYS, configPath, 'checkCache.');

  const config: CheckCacheConfig = {};

  const enabled: unknown = checkCache['enabled'];
  if (enabled !== undefined) {
    if (typeof enabled !== 'boolean') {
      throw new TypeError(`Invalid nmr config at ${configPath}: \`checkCache.enabled\` must be a boolean`);
    }
    config.enabled = enabled;
  }

  for (const field of ['excludeCommands', 'extraCommands'] as const) {
    const commands: unknown = checkCache[field];
    if (commands === undefined) {
      continue;
    }
    if (!isStringArray(commands)) {
      throw new Error(`Invalid nmr config at ${configPath}: \`checkCache.${field}\` must be a string[]`);
    }
    config[field] = commands;
  }

  return config;
}

/** Validates and extracts a `Record<string, string>` field from the raw config object. */
function validateStringRecordField(
  value: Record<string, unknown>,
  fieldName: string,
  configPath: string,
): Record<string, string> | undefined {
  if (!Object.hasOwn(value, fieldName) || value[fieldName] === undefined) {
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

  const checkCache = validateCheckCacheField(value, configPath);
  if (checkCache) config.checkCache = checkCache;

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
  const loaded = isObject(imported) ? imported['default'] : undefined;

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
