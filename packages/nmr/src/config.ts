import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { resolveConfigPath } from './helpers/config-path.ts';
import { findClosestName } from './helpers/findClosestName.ts';
import { isHookName } from './helpers/hook-name.ts';
import { isObject, isStringRecord } from './helpers/type-guards.ts';
import { buildRootRegistry, buildWorkspaceRegistry, readPackageJsonScripts } from './resolver.ts';
import { findUnexpressibleToken } from './steps.ts';
import type { BuildConfig, CheckCacheConfig, NmrConfig, OutputConfig, ScriptValue, StepSpec } from './types.ts';
import { UserError } from './UserError.ts';
import { formatVerbosityRejection, isCommandVerbosity } from './verbosity.ts';
import { getWorkspacePackageDirs, isMonorepoRoot } from './workspace.ts';

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
    honoredKeys: ['checkCache', 'devBin', 'output', 'rootScripts', 'workspaceScripts'],
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
const RECOGNIZED_OUTPUT_KEYS = ['commandVerbosity', 'extraAgentEnvVars'];
const RECOGNIZED_STEP_KEYS = ['declinesArgs', 'run'];

/** Narrows an unknown value to a record of script entries. */
function isScriptRecord(value: unknown): value is Record<string, ScriptValue> {
  if (!isObject(value)) return false;
  for (const v of Object.values(value)) {
    if (typeof v === 'string') continue;
    if (!Array.isArray(v) || !v.every(isScriptElement)) return false;
  }
  return true;
}

/** Narrows an unknown value to a composite element: the bare instruction, or the spec that also declares. */
function isScriptElement(value: unknown): value is string | StepSpec {
  if (typeof value === 'string') return true;
  if (!isObject(value) || typeof value['run'] !== 'string') return false;

  const declinesArgs: unknown = value['declinesArgs'];
  return declinesArgs === undefined || typeof declinesArgs === 'boolean';
}

/** Validates and extracts a single script-record field from the raw config object. */
function validateScriptField(
  value: Record<string, unknown>,
  fieldName: string,
  configPath: string,
): Record<string, ScriptValue> | undefined {
  if (!Object.hasOwn(value, fieldName) || value[fieldName] === undefined) {
    return undefined;
  }
  const scripts = value[fieldName];
  if (!isScriptRecord(scripts)) {
    throw new UserError(
      `Invalid nmr config at ${configPath}: \`${fieldName}\` must be a Record<string, string | element[]>, ` +
        'where an element is a command string or `{ run: string, declinesArgs?: boolean }`',
    );
  }
  assertValidElements(scripts, fieldName, configPath);
  return scripts;
}

/**
 * Rejects a composite element outside the grammar on either axis.
 *
 * An instruction is a command name optionally preceded by nmr's own flags; one carrying a quoted argument or
 * shell syntax renders as a single quoted token, so accepting it would run a command nobody wrote. A spec
 * carrying a key nmr does not recognize is rejected for the reason every other nested config object is: a
 * misspelled `declinesArgs` would otherwise read as the default, narrowing a step meant to decline.
 */
function assertValidElements(scripts: Record<string, ScriptValue>, fieldName: string, configPath: string): void {
  for (const [command, script] of Object.entries(scripts)) {
    if (typeof script === 'string') continue;

    for (const spec of script) {
      if (typeof spec !== 'string') {
        assertRecognizedKeys(spec, RECOGNIZED_STEP_KEYS, configPath, `${fieldName}.${command}.`);
      }

      const element = typeof spec === 'string' ? spec : spec.run;
      const token = findUnexpressibleToken(element);
      if (token === undefined) continue;

      throw new UserError(
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
    throw new UserError(`Invalid nmr config at ${configPath}: \`build\` must be an object`);
  }
  assertRecognizedKeys(build, RECOGNIZED_BUILD_KEYS, configPath, 'build.');

  const extraIgnorePatterns: unknown = build['extraIgnorePatterns'];
  if (extraIgnorePatterns !== undefined && !isStringArray(extraIgnorePatterns)) {
    throw new UserError(`Invalid nmr config at ${configPath}: \`build.extraIgnorePatterns\` must be a string[]`);
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
    throw new UserError(`Invalid nmr config at ${configPath}: \`checkCache\` must be an object`);
  }
  assertRecognizedKeys(checkCache, RECOGNIZED_CHECK_CACHE_KEYS, configPath, 'checkCache.');

  const config: CheckCacheConfig = {};

  const enabled: unknown = checkCache['enabled'];
  if (enabled !== undefined) {
    if (typeof enabled !== 'boolean') {
      throw new UserError(`Invalid nmr config at ${configPath}: \`checkCache.enabled\` must be a boolean`);
    }
    config.enabled = enabled;
  }

  for (const field of ['excludeCommands', 'extraCommands'] as const) {
    const commands: unknown = checkCache[field];
    if (commands === undefined) {
      continue;
    }
    if (!isStringArray(commands)) {
      throw new UserError(`Invalid nmr config at ${configPath}: \`checkCache.${field}\` must be a string[]`);
    }
    config[field] = commands;
  }

  return config;
}

/**
 * Rejects a `checkCache` name that resolves to no command. Both fields are read by name alone, so a misspelt
 * entry is inert: the command it meant to name goes on running, indistinguishable from one that cannot be
 * cached at all.
 *
 * The test is resolvability rather than membership of the cacheable set, so an `excludeCommands` entry written
 * against a name a later release moves out of the defaults keeps standing.
 *
 * Reads nothing while every name resolves in the merged registries, and reaches a package's own `scripts` only
 * once one misses them: those are a resolution tier of their own, so a name declared only there is valid.
 *
 * Stands aside outside a monorepo root, where `checkCache` is a key this tier does not honor. `assertTierKeys`
 * reports that, and of the two messages it is the one that names the real mistake.
 */
function assertResolvableCheckCacheCommands(config: NmrConfig, configPath: string, baseDir: string): void {
  const { checkCache } = config;
  if (checkCache === undefined || !isMonorepoRoot(baseDir)) {
    return;
  }

  const fields = ['excludeCommands', 'extraCommands'] as const;
  const entries = fields.flatMap((field) => (checkCache[field] ?? []).map((command) => ({ command, field })));

  const hook = entries.find(({ command }) => isHookName(command));
  if (hook !== undefined) {
    throw new UserError(
      `Invalid nmr config at ${configPath}: \`checkCache.${hook.field}\` names the hook \`${hook.command}\`, ` +
        'which is never gated on its own: it runs as part of the chain of the command it wraps.',
    );
  }

  const registered = new Set([
    ...Object.keys(buildRootRegistry(config)),
    ...Object.keys(buildWorkspaceRegistry(config)),
  ]);
  const missing = entries.filter(({ command }) => !registered.has(command));
  if (missing.length === 0) {
    return;
  }

  const declared = readDeclaredScriptNames(baseDir);
  const unresolvable = missing.find(({ command }) => !declared.has(command));
  if (unresolvable === undefined) {
    return;
  }

  const closest = findClosestName(unresolvable.command, [...registered, ...declared]);
  throw new UserError(
    `Invalid nmr config at ${configPath}: \`checkCache.${unresolvable.field}\` names no command: ` +
      `\`${unresolvable.command}\`.${closest === undefined ? '' : ` Did you mean \`${closest}\`?`}`,
  );
}

/**
 * Collects the command names the workspace's `package.json` files declare, the resolution tier the merged
 * registries do not describe.
 *
 * A manifest whose content this cannot read contributes no names, and a readable sibling still contributes its
 * own. The sweep runs for the config's sake rather than the package's, so a manifest that is malformed
 * elsewhere in the workspace must not fail every command run anywhere in it; the package's own runs report it,
 * where the message names something the reader was asking about.
 *
 * A package manifest that cannot be read at all is a different matter and propagates. An unreadable path is a
 * fault in the checkout rather than a statement about the manifest's content, and one nothing else here would
 * report.
 */
function readDeclaredScriptNames(monorepoRoot: string): Set<string> {
  let packageDirs: string[];
  try {
    packageDirs = getWorkspacePackageDirs(monorepoRoot);
  } catch {
    packageDirs = [];
  }

  const names = new Set<string>();
  const dirs = [monorepoRoot, ...packageDirs];
  for (const dir of dirs) {
    const scripts = readPackageScripts(dir);
    for (const name of Object.keys(scripts)) {
      names.add(name);
    }
  }

  return names;
}

/** Reads one package's declared scripts, treating a manifest whose content does not parse as declaring none. */
function readPackageScripts(packageDir: string): Record<string, string> {
  try {
    return readPackageJsonScripts(packageDir) ?? {};
  } catch (error: unknown) {
    if (error instanceof UserError) {
      return {};
    }
    throw error;
  }
}

/** Validates and extracts the `output` field from the raw config object. */
function validateOutputField(value: Record<string, unknown>, configPath: string): OutputConfig | undefined {
  const output: unknown = value['output'];
  if (output === undefined) {
    return undefined;
  }
  if (!isObject(output)) {
    throw new UserError(`Invalid nmr config at ${configPath}: \`output\` must be an object`);
  }
  assertRecognizedKeys(output, RECOGNIZED_OUTPUT_KEYS, configPath, 'output.');

  const config: OutputConfig = {};

  const commandVerbosity: unknown = output['commandVerbosity'];
  if (commandVerbosity !== undefined) {
    if (typeof commandVerbosity !== 'string' || !isCommandVerbosity(commandVerbosity)) {
      // A non-string renders through JSON so an object reaches the reader as its shape, not `[object Object]`.
      const rendered = typeof commandVerbosity === 'string' ? commandVerbosity : JSON.stringify(commandVerbosity);
      throw new UserError(
        `Invalid nmr config at ${configPath}: ${formatVerbosityRejection('`output.commandVerbosity`', rendered)}`,
      );
    }
    config.commandVerbosity = commandVerbosity;
  }

  const extraAgentEnvVars: unknown = output['extraAgentEnvVars'];
  if (extraAgentEnvVars !== undefined) {
    if (!isStringArray(extraAgentEnvVars)) {
      throw new UserError(`Invalid nmr config at ${configPath}: \`output.extraAgentEnvVars\` must be a string[]`);
    }
    config.extraAgentEnvVars = extraAgentEnvVars;
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
    throw new UserError(`Invalid nmr config at ${configPath}: \`${fieldName}\` must be a Record<string, string>`);
  }
  return value[fieldName];
}

/** Validates that a loaded value conforms to the expected `NmrConfig` shape. */
function validateConfig(value: unknown, configPath: string, baseDir: string): NmrConfig {
  if (!isObject(value)) {
    throw new UserError(`Invalid nmr config at ${configPath}: expected an object, got ${typeof value}`);
  }
  assertRecognizedKeys(value, RECOGNIZED_KEYS, configPath);

  const config: NmrConfig = {};

  const build = validateBuildField(value, configPath);
  if (build) config.build = build;

  const checkCache = validateCheckCacheField(value, configPath);
  if (checkCache) config.checkCache = checkCache;

  const devBin = validateStringRecordField(value, 'devBin', configPath);
  if (devBin) config.devBin = devBin;

  const output = validateOutputField(value, configPath);
  if (output) config.output = output;

  const workspaceScripts = validateScriptField(value, 'workspaceScripts', configPath);
  if (workspaceScripts) config.workspaceScripts = workspaceScripts;

  const rootScripts = validateScriptField(value, 'rootScripts', configPath);
  if (rootScripts) config.rootScripts = rootScripts;

  // Last, because it resolves the names against the registries the script fields above contribute to.
  assertResolvableCheckCacheCommands(config, configPath, baseDir);

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

  return validateConfig(loaded, configPath, baseDir);
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
function assertRecognizedKeys(value: object, recognizedKeys: string[], configPath: string, prefix = ''): void {
  const unrecognized = Object.keys(value).filter((key) => !recognizedKeys.includes(key));
  if (unrecognized.length === 0) {
    return;
  }

  throw new UserError(
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

  throw new UserError(
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
