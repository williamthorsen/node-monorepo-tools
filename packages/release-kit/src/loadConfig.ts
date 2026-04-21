import { existsSync } from 'node:fs';
import path from 'node:path';

import { component } from './component.ts';
import {
  DEFAULT_CHANGELOG_JSON_CONFIG,
  DEFAULT_RELEASE_NOTES_CONFIG,
  DEFAULT_VERSION_PATTERNS,
  DEFAULT_WORK_TYPES,
} from './defaults.ts';
import { isRecord } from './typeGuards.ts';
import type {
  ChangelogJsonConfig,
  ComponentConfig,
  MonorepoReleaseConfig,
  ReleaseConfig,
  ReleaseKitConfig,
  ReleaseNotesConfig,
  WorkTypeConfig,
} from './types.ts';

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

  // Detect duplicate tagPrefix values before filtering so exclusions cannot hide collisions.
  assertUniqueTagPrefixes(components);

  // Apply component overrides from user config
  if (userConfig?.components !== undefined) {
    const overrides = new Map(userConfig.components.map((c) => [c.dir, c]));

    components = components
      .filter((c) => {
        const override = overrides.get(c.dir);
        return override?.shouldExclude !== true;
      })
      .map((c) => {
        const override = overrides.get(c.dir);
        if (override?.legacyTagPrefixes === undefined) {
          return c;
        }
        assertLegacyTagPrefixesDoNotIncludeDerived(c.dir, c.tagPrefix, override.legacyTagPrefixes);
        return { ...c, legacyTagPrefixes: [...override.legacyTagPrefixes] };
      });
  }

  // Merge workTypes
  const workTypes = resolveWorkTypes(userConfig?.workTypes);

  // versionPatterns: consumer replaces entirely
  const versionPatterns =
    userConfig?.versionPatterns === undefined ? { ...DEFAULT_VERSION_PATTERNS } : { ...userConfig.versionPatterns };

  const changelogJson = mergeChangelogJsonConfig(userConfig?.changelogJson);
  const releaseNotes = mergeReleaseNotesConfig(userConfig?.releaseNotes);

  const result: MonorepoReleaseConfig = {
    components,
    workTypes,
    versionPatterns,
    changelogJson,
    releaseNotes,
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
  const workTypes = resolveWorkTypes(userConfig?.workTypes);

  const versionPatterns =
    userConfig?.versionPatterns === undefined ? { ...DEFAULT_VERSION_PATTERNS } : { ...userConfig.versionPatterns };

  const changelogJson = mergeChangelogJsonConfig(userConfig?.changelogJson);
  const releaseNotes = mergeReleaseNotesConfig(userConfig?.releaseNotes);

  const result: ReleaseConfig = {
    tagPrefix: 'v',
    packageFiles: ['package.json'],
    changelogPaths: ['.'],
    workTypes,
    versionPatterns,
    changelogJson,
    releaseNotes,
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
 * Merge consumer work-type overrides onto `DEFAULT_WORK_TYPES`.
 *
 * Preserves the declaration order of defaults; net-new consumer keys append at the end.
 */
export function resolveWorkTypes(userWorkTypes?: Record<string, WorkTypeConfig>): Record<string, WorkTypeConfig> {
  return userWorkTypes === undefined ? { ...DEFAULT_WORK_TYPES } : { ...DEFAULT_WORK_TYPES, ...userWorkTypes };
}

/** Merge user-provided changelog JSON config with defaults. */
function mergeChangelogJsonConfig(partial: Partial<ChangelogJsonConfig> | undefined): ChangelogJsonConfig {
  if (partial === undefined) {
    return { ...DEFAULT_CHANGELOG_JSON_CONFIG };
  }
  return {
    enabled: partial.enabled ?? DEFAULT_CHANGELOG_JSON_CONFIG.enabled,
    outputPath: partial.outputPath ?? DEFAULT_CHANGELOG_JSON_CONFIG.outputPath,
    devOnlySections: partial.devOnlySections ?? [...DEFAULT_CHANGELOG_JSON_CONFIG.devOnlySections],
  };
}

/**
 * Throw when a component's `legacyTagPrefixes` contains the workspace's derived tag prefix.
 *
 * A legacy entry equal to the derived prefix is a guaranteed no-op duplicate, almost always
 * a copy-paste mistake. Rejecting it early prevents silent config drift.
 */
function assertLegacyTagPrefixesDoNotIncludeDerived(
  dir: string,
  derivedPrefix: string,
  legacyTagPrefixes: readonly string[],
): void {
  if (legacyTagPrefixes.includes(derivedPrefix)) {
    throw new Error(
      `Component '${dir}': legacyTagPrefixes must not include the derived prefix '${derivedPrefix}'. ` +
        'The derived prefix is always searched; listing it again is a no-op.',
    );
  }
}

/**
 * Throw when two or more components share the same `tagPrefix`.
 *
 * A collision means two workspaces would produce indistinguishable tags, breaking both tag
 * creation and tag resolution. The error lists every colliding workspace path so the author
 * can rename one of the conflicting `package.json` `name` fields.
 */
function assertUniqueTagPrefixes(components: readonly ComponentConfig[]): void {
  const pathsByPrefix = new Map<string, string[]>();
  for (const component of components) {
    const existing = pathsByPrefix.get(component.tagPrefix);
    if (existing === undefined) {
      pathsByPrefix.set(component.tagPrefix, [component.workspacePath]);
    } else {
      existing.push(component.workspacePath);
    }
  }

  for (const [prefix, paths] of pathsByPrefix) {
    if (paths.length > 1) {
      throw new Error(`Duplicate tag prefix '${prefix}' for workspaces: ${paths.join(', ')}`);
    }
  }
}

/** Merge user-provided release notes config with defaults. */
function mergeReleaseNotesConfig(partial: Partial<ReleaseNotesConfig> | undefined): ReleaseNotesConfig {
  if (partial === undefined) {
    return { ...DEFAULT_RELEASE_NOTES_CONFIG };
  }
  return {
    shouldInjectIntoReadme: partial.shouldInjectIntoReadme ?? DEFAULT_RELEASE_NOTES_CONFIG.shouldInjectIntoReadme,
  };
}
