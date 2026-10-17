import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { CONFIG_TIERS, type ConfigTier, validateConfig } from './config-validation.ts';
import { resolveConfigPath } from './helpers/config-path.ts';
import { escapeControlCharacters } from './helpers/escapeControlCharacters.ts';
import { isHookName } from './helpers/hook-name.ts';
import { isObject } from './helpers/type-guards.ts';
import { getDefaultRootScripts, getDefaultWorkspaceScripts } from './resolve-scripts.ts';
import { describeScript } from './resolver.ts';
import { readSelfReference, readStepListSelfReference, type SelfReference, type SelfReferenceScope } from './steps.ts';
import type { NmrConfig } from './types.ts';
import { UserError } from './UserError.ts';

/** The config fields that declare scripts, each with the scope in which its entries resolve. */
const SCRIPT_FIELDS: ReadonlyArray<{ field: 'rootScripts' | 'workspaceScripts'; scope: SelfReferenceScope }> = [
  { field: 'rootScripts', scope: 'root' },
  { field: 'workspaceScripts', scope: 'workspaceRegistry' },
];

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

  // Node type-strips `.ts` natively at this package's engines floor, so the config does not need a transform
  // step or a loader dependency. `import()` takes a URL, not a path: A bare Windows path parses as a scheme.
  const importedModule: unknown = await import(pathToFileURL(configPath).href);
  const loadedConfig = isObject(importedModule) ? importedModule['default'] : undefined;

  return validateConfig(loadedConfig, configPath, baseDir);
}

/**
 * Loads the monorepo-root `.config/nmr.config.ts`, the tier that feeds script resolution and `devBin`.
 * Returns an empty config if the file doesn't exist.
 *
 * Throws on a recognized key that this tier does not honor. `build` governs one package's compile, which reads the
 * package's own config alone, so a `build` accepted here would apply its patterns nowhere.
 */
export async function loadRootConfig(monorepoRoot: string): Promise<NmrConfig> {
  const config = await loadConfig(monorepoRoot);
  const configPath = resolveConfigPath(monorepoRoot);
  assertTierKeys(config, CONFIG_TIERS.root, configPath);
  assertNoSelfReferences(config, configPath, monorepoRoot);

  return config;
}

/**
 * Loads a single package's `.config/nmr.config.ts`, the tier that `nmr-compile` reads from its working
 * directory. Returns an empty config if the file doesn't exist.
 *
 * Throws on a recognized key that this tier does not honor. Dropping one would leave a package building on
 * settings that its own config file appears to change, which nothing in the build's output would reveal.
 */
export async function loadWorkspaceConfig(packageDir: string): Promise<NmrConfig> {
  const config = await loadConfig(packageDir);
  assertTierKeys(config, CONFIG_TIERS.workspace, resolveConfigPath(packageDir));

  return config;
}

// region | Helpers

/**
 * Throws on a script entry that names the key under which it is declared, as a shell segment of a string value or
 * as a step-list element, naming the entry and the edit that resolves it.
 *
 * Running such an entry re-enters it without bound. Discarding it would run the built-in default, which the repo
 * did not declare, so an entry declaring nothing besides the self-reference is rejected too.
 */
function assertNoSelfReferences(config: NmrConfig, configPath: string, monorepoRoot: string): void {
  for (const { field, scope } of SCRIPT_FIELDS) {
    const scripts = config[field] ?? {};
    for (const [key, script] of Object.entries(scripts)) {
      const selfReference =
        typeof script === 'string'
          ? readSelfReference({ commandName: key, scope, script })
          : readStepListSelfReference({
              commandName: key,
              elements: script.map((element) => (typeof element === 'string' ? element : element.run)),
              scope,
            });
      if (selfReference === undefined) continue;

      const defaults = field === 'rootScripts' ? getDefaultRootScripts(monorepoRoot) : getDefaultWorkspaceScripts();
      const remedy = formatSelfReferenceRemedy({
        isDefault: !isHookName(key) && Object.hasOwn(defaults, key),
        key,
        selfReference,
      });

      throw new UserError(
        `Invalid nmr config at ${configPath}: \`${field}.${key}\` re-invokes \`${key}\` ` +
          `(\`${escapeControlCharacters(describeScript(script))}\`), which would re-enter nmr without bound. ${remedy}`,
      );
    }
  }
}

/**
 * Throws when a config declares a recognized key belonging to the other tier, naming the offenders and where
 * they go. Each tier loads the same file shape, so only the loader can tell a key apart from one that it honors.
 */
function assertTierKeys(config: NmrConfig, tier: ConfigTier, configPath: string): void {
  const unsupportedKeys = Object.keys(config).filter((key) => !tier.honoredKeys.includes(key));
  if (unsupportedKeys.length === 0) {
    return;
  }

  throw new UserError(
    `Invalid nmr config at ${configPath}: ${tier.label} honors ${tier.honoredKeys.toSorted().join(', ')} alone, ` +
      `not ${unsupportedKeys.toSorted().join(', ')}. Move those keys to ${tier.elsewhere}.`,
  );
}

/**
 * Returns the edit that resolves a self-referencing config entry.
 *
 * Only a key that the built-in defaults define has a command below the entry for a `:pre` or `:post` script to
 * wrap. For any other key, the steps beside the re-invocation are the command.
 */
function formatSelfReferenceRemedy(options: { isDefault: boolean; key: string; selfReference: SelfReference }): string {
  const { isDefault, key, selfReference } = options;

  if (isDefault) {
    return selfReference === 'sole'
      ? `Delete the entry: nmr's own \`${key}\` then runs.`
      : `Delete the entry and move the steps that it adds to a \`${key}:pre\` or \`${key}:post\` script.`;
  }

  return selfReference === 'sole'
    ? 'Delete the entry.'
    : `Delete the re-invocation: \`${key}\` runs the steps beside it.`;
}

// endregion | Helpers
