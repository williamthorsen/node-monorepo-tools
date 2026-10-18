import { assertResolvableCheckCacheCommands } from './config-check-cache.ts';
import { isObject, isStringRecord } from './helpers/type-guards.ts';
import { findUnexpressibleToken } from './steps.ts';
import type {
  BuildConfig,
  CheckCacheConfig,
  NmrConfig,
  OutputConfig,
  ScriptValue,
  SelfHostedRunnerConfig,
  StepSpec,
} from './types.ts';
import { UserError } from './UserError.ts';
import { formatVerbosityRejection, isCommandVerbosity } from './verbosity.ts';

/**
 * The keys that each tier honors, and where the other tier's belong. Every recognized key belongs to exactly one
 * tier, and `RECOGNIZED_KEYS` is their union.
 */
export const CONFIG_TIERS: Record<'root' | 'workspace', ConfigTier> = {
  root: {
    label: 'a monorepo-root config',
    honoredKeys: ['checkCache', 'delegate', 'devBin', 'output', 'rootScripts', 'selfHostedRunner', 'workspaceScripts'],
    elsewhere: "the package's own config",
  },
  workspace: {
    label: 'a package config',
    honoredKeys: ['build'],
    elsewhere: 'the monorepo-root config',
  },
};

export interface ConfigTier {
  /** Names the tier in an error message. */
  label: string;
  honoredKeys: string[];
  /** Names where a key that this tier does not honor belongs. */
  elsewhere: string;
}

const RECOGNIZED_KEYS = [...CONFIG_TIERS.root.honoredKeys, ...CONFIG_TIERS.workspace.honoredKeys];
const RECOGNIZED_BUILD_KEYS = ['extraIgnorePatterns'];
const RECOGNIZED_CHECK_CACHE_KEYS = ['enabled', 'excludeCommands', 'extraCommands'];
const RECOGNIZED_OUTPUT_KEYS = ['commandVerbosity', 'extraAgentEnvVars'];
const RECOGNIZED_SELF_HOSTED_RUNNER_KEYS = ['exempt'];
const RECOGNIZED_STEP_KEYS = ['run', 'shouldDeclineArguments', 'shouldRunInBackground'];

/** Maps each retired step key to the key that replaced it. */
const RETIRED_STEP_KEYS: ReadonlyMap<string, string> = new Map([['declinesArgs', 'shouldDeclineArguments']]);

/**
 * Throws on any key outside the recognized set, naming the offenders and the file. An unrecognized key is a
 * typo or a stale spelling, and the setting that it appears to make is one that nothing reads.
 */
export function assertRecognizedKeys(value: object, recognizedKeys: string[], configPath: string, prefix = ''): void {
  const unrecognizedKeys = Object.keys(value).filter((key) => !recognizedKeys.includes(key));
  if (unrecognizedKeys.length === 0) {
    return;
  }

  throw new UserError(
    `Invalid nmr config at ${configPath}: unrecognized ${unrecognizedKeys.length === 1 ? 'key' : 'keys'} ` +
      `${formatKeyList(unrecognizedKeys, prefix)}. Recognized: ${formatKeyList(recognizedKeys, prefix)}.`,
  );
}

/** Validates that a loaded value conforms to the expected `NmrConfig` shape. */
export function validateConfig(value: unknown, configPath: string, baseDir: string): NmrConfig {
  if (!isObject(value)) {
    throw new UserError(`Invalid nmr config at ${configPath}: expected an object, got ${typeof value}`);
  }
  assertRecognizedKeys(value, RECOGNIZED_KEYS, configPath);

  const config: NmrConfig = {};

  const build = validateBuildField(value, configPath);
  if (build) config.build = build;

  const checkCache = validateCheckCacheField(value, configPath);
  if (checkCache) config.checkCache = checkCache;

  if (value['delegate'] !== undefined) config.delegate = validateDelegateField(value['delegate'], configPath);

  const devBin = validateStringRecordField(value, 'devBin', configPath);
  if (devBin) config.devBin = devBin;

  const output = validateOutputField(value, configPath);
  if (output) config.output = output;

  const workspaceScripts = validateScriptField(value, 'workspaceScripts', configPath);
  if (workspaceScripts) config.workspaceScripts = workspaceScripts;

  const rootScripts = validateScriptField(value, 'rootScripts', configPath);
  if (rootScripts) config.rootScripts = rootScripts;

  const selfHostedRunner = validateSelfHostedRunnerField(value, configPath);
  if (selfHostedRunner) config.selfHostedRunner = selfHostedRunner;

  // Run last, because it resolves the names against the registries to which the script fields above contribute.
  assertResolvableCheckCacheCommands(config, configPath, baseDir);

  return config;
}

// region | Helpers

/** Throws on a retired key, naming the key that replaced it. */
function assertNoRetiredKeys(
  value: object,
  retiredKeys: ReadonlyMap<string, string>,
  configPath: string,
  prefix: string,
): void {
  for (const key of Object.keys(value)) {
    const replacement = retiredKeys.get(key);
    if (replacement === undefined) continue;

    throw new UserError(
      `Invalid nmr config at ${configPath}: \`${prefix}${key}\` was renamed to \`${prefix}${replacement}\`.`,
    );
  }
}

/**
 * Rejects a composite element outside the grammar on either axis.
 *
 * An instruction is a command name optionally preceded by nmr's own flags; one containing a quoted argument or
 * shell syntax renders as a single quoted token, so accepting it would run a command that nobody wrote. A spec
 * containing a key that nmr does not recognize is rejected for the reason every other nested config object is:
 * A misspelled `shouldDeclineArguments` would otherwise read as the default, narrowing a step meant to decline.
 */
function assertValidElements(scripts: Record<string, ScriptValue>, fieldName: string, configPath: string): void {
  for (const [command, script] of Object.entries(scripts)) {
    if (typeof script === 'string') continue;

    for (const spec of script) {
      if (typeof spec !== 'string') {
        assertNoRetiredKeys(spec, RETIRED_STEP_KEYS, configPath, `${fieldName}.${command}.`);
        assertRecognizedKeys(spec, RECOGNIZED_STEP_KEYS, configPath, `${fieldName}.${command}.`);
      }

      const element = typeof spec === 'string' ? spec : spec.run;
      const token = findUnexpressibleToken(element);
      if (token === undefined) continue;

      throw new UserError(
        `Invalid nmr config at ${configPath}: \`${fieldName}.${command}\` element \`${element}\` contains ` +
          `\`${token}\`, which is neither a command name nor an nmr flag. Name it as a script of its own and ` +
          `reference that name here.`,
      );
    }
  }
}

/** Renders config keys as a sorted, backtick-quoted list, each with the prefix of the field containing them. */
function formatKeyList(keys: string[], prefix: string): string {
  return keys
    .toSorted()
    .map((key) => `\`${prefix}${key}\``)
    .join(', ');
}

/** Reports whether a value is absent or a boolean. */
function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

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

  return isOptionalBoolean(value['shouldDeclineArguments']) && isOptionalBoolean(value['shouldRunInBackground']);
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

  const enabledValue: unknown = checkCache['enabled'];
  if (enabledValue !== undefined) {
    if (typeof enabledValue !== 'boolean') {
      throw new UserError(`Invalid nmr config at ${configPath}: \`checkCache.enabled\` must be a boolean`);
    }
    config.enabled = enabledValue;
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
 * Validates the repo's `delegate`, which accepts `false` alone: Which hosts a machine reaches, and when it
 * delegates, are facts about the machine, which a shared repo config cannot state.
 */
function validateDelegateField(delegate: unknown, configPath: string): false {
  if (delegate === false) {
    return false;
  }

  throw new UserError(
    `Invalid nmr config at ${configPath}: \`delegate\` accepts only \`false\`, which keeps the repo's checks on the ` +
      'machine that has the tree. Hosts and `when` belong in the user config, `~/.config/nmr/config.ts`.',
  );
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
      // Render a non-string through JSON so that the reader sees an object's shape, not `[object Object]`.
      const renderedValue = typeof commandVerbosity === 'string' ? commandVerbosity : JSON.stringify(commandVerbosity);
      throw new UserError(
        `Invalid nmr config at ${configPath}: ${formatVerbosityRejection('`output.commandVerbosity`', renderedValue)}`,
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

/** Validates and extracts the `selfHostedRunner` field from the raw config object. */
function validateSelfHostedRunnerField(
  value: Record<string, unknown>,
  configPath: string,
): SelfHostedRunnerConfig | undefined {
  const selfHostedRunner: unknown = value['selfHostedRunner'];
  if (selfHostedRunner === undefined) {
    return undefined;
  }
  if (!isObject(selfHostedRunner)) {
    throw new UserError(`Invalid nmr config at ${configPath}: \`selfHostedRunner\` must be an object`);
  }
  assertRecognizedKeys(selfHostedRunner, RECOGNIZED_SELF_HOSTED_RUNNER_KEYS, configPath, 'selfHostedRunner.');

  // The reason is the record of why a qualifying repo stays off the runners, so an empty one records nothing.
  const exempt: unknown = selfHostedRunner['exempt'];
  if (typeof exempt !== 'string' || exempt.trim() === '') {
    throw new UserError(
      `Invalid nmr config at ${configPath}: \`selfHostedRunner.exempt\` must be a non-empty string giving the reason`,
    );
  }

  return { exempt };
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
        'where an element is a command string or ' +
        '`{ run: string, shouldDeclineArguments?: boolean, shouldRunInBackground?: boolean }`',
    );
  }
  assertValidElements(scripts, fieldName, configPath);
  return scripts;
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

// endregion | Helpers
