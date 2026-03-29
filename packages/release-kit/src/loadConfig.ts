import { existsSync } from 'node:fs';
import path from 'node:path';

import { component } from './component.ts';
import { DEFAULT_VERSION_PATTERNS, DEFAULT_WORK_TYPES } from './defaults.ts';
import { isRecord } from './typeGuards.ts';
import type { ComponentConfig, MonorepoReleaseConfig, ReleaseConfig, ReleaseKitConfig } from './types.ts';

/** The path where the consumer-facing config file is expected. */
export const CONFIG_FILE_PATH = '.config/release-kit.config.ts';

/**
 * Loads the config file at `.config/release-kit.config.ts` using jiti for TypeScript loading.
 *
 * @returns The raw config object, or `undefined` if the file does not exist.
 * @throws If the file exists but cannot be loaded or does not have a default export.
 */
export async function loadConfig(): Promise<unknown> {
  const absoluteConfigPath = path.resolve(process.cwd(), CONFIG_FILE_PATH);

  if (!existsSync(absoluteConfigPath)) {
    return undefined;
  }

  const { createJiti } = await import('jiti');
  const jiti = createJiti(import.meta.url);
  const imported: unknown = await jiti.import(absoluteConfigPath);

  if (!isRecord(imported)) {
    throw new Error(`Config file must export an object, got ${Array.isArray(imported) ? 'array' : typeof imported}`);
  }

  // Support both default export and named `config` export
  const resolved = imported.default ?? imported.config;
  if (resolved === undefined) {
    throw new Error(
      'Config file must have a default export or a named `config` export (e.g., `export default { ... }` or `export const config = { ... }`)',
    );
  }

  return resolved;
}

/**
 * Resolves a final monorepo config from discovered workspaces and an optional user config overlay.
 *
 * Merging rules:
 * - `components`: match overlay entries by `dir` against discovered list; `shouldExclude: true`
 *   removes the component; unlisted packages keep defaults.
 * - `workTypes`: shallow merge — consumer entries override or add to defaults by key.
 * - `versionPatterns`: consumer value replaces defaults entirely.
 * - `formatCommand`, `cliffConfigPath`, `scopeAliases`: consumer value wins.
 */
export function mergeMonorepoConfig(
  discoveredPaths: string[],
  userConfig: ReleaseKitConfig | undefined,
): MonorepoReleaseConfig {
  // Build default components from discovered paths
  let components: ComponentConfig[] = discoveredPaths.map((workspacePath) => component(workspacePath));

  // Apply component overrides from user config
  if (userConfig?.components !== undefined) {
    const overrides = new Map(userConfig.components.map((c) => [c.dir, c]));

    components = components.filter((c) => {
      const override = overrides.get(c.dir);
      return override?.shouldExclude !== true;
    });
  }

  // Merge workTypes
  const workTypes =
    userConfig?.workTypes === undefined
      ? { ...DEFAULT_WORK_TYPES }
      : { ...DEFAULT_WORK_TYPES, ...userConfig.workTypes };

  // versionPatterns: consumer replaces entirely
  const versionPatterns =
    userConfig?.versionPatterns === undefined ? { ...DEFAULT_VERSION_PATTERNS } : { ...userConfig.versionPatterns };

  const result: MonorepoReleaseConfig = {
    components,
    workTypes,
    versionPatterns,
  };

  const formatCommand = userConfig?.formatCommand;
  if (formatCommand !== undefined) {
    result.formatCommand = formatCommand;
  }

  const cliffConfigPath = userConfig?.cliffConfigPath;
  if (cliffConfigPath !== undefined) {
    result.cliffConfigPath = cliffConfigPath;
  }

  const scopeAliases = userConfig?.scopeAliases;
  if (scopeAliases !== undefined) {
    result.scopeAliases = scopeAliases;
  }

  return result;
}

/**
 * Resolves a final single-package config from an optional user config overlay.
 */
export function mergeSinglePackageConfig(userConfig: ReleaseKitConfig | undefined): ReleaseConfig {
  const workTypes =
    userConfig?.workTypes === undefined
      ? { ...DEFAULT_WORK_TYPES }
      : { ...DEFAULT_WORK_TYPES, ...userConfig.workTypes };

  const versionPatterns =
    userConfig?.versionPatterns === undefined ? { ...DEFAULT_VERSION_PATTERNS } : { ...userConfig.versionPatterns };

  const result: ReleaseConfig = {
    tagPrefix: 'v',
    packageFiles: ['package.json'],
    changelogPaths: ['.'],
    workTypes,
    versionPatterns,
  };

  const formatCommand = userConfig?.formatCommand;
  if (formatCommand !== undefined) {
    result.formatCommand = formatCommand;
  }

  const cliffConfigPath = userConfig?.cliffConfigPath;
  if (cliffConfigPath !== undefined) {
    result.cliffConfigPath = cliffConfigPath;
  }

  const scopeAliases = userConfig?.scopeAliases;
  if (scopeAliases !== undefined) {
    result.scopeAliases = scopeAliases;
  }

  return result;
}
