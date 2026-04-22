import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_CHANGELOG_JSON_CONFIG,
  DEFAULT_RELEASE_NOTES_CONFIG,
  DEFAULT_VERSION_PATTERNS,
  DEFAULT_WORK_TYPES,
} from './defaults.ts';
import { deriveWorkspaceConfig } from './deriveWorkspaceConfig.ts';
import { isRecord } from './typeGuards.ts';
import type {
  ChangelogJsonConfig,
  LegacyIdentity,
  MonorepoReleaseConfig,
  ReleaseConfig,
  ReleaseKitConfig,
  ReleaseNotesConfig,
  RetiredPackage,
  WorkspaceConfig,
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
 * - `workspaces`: match overlay entries by `dir` against discovered list; `shouldExclude: true`
 *   removes the workspace; unlisted packages keep defaults.
 * - `workTypes`: shallow merge — consumer entries override or add to defaults by key.
 * - `versionPatterns`: consumer value replaces defaults entirely.
 * - `formatCommand`, `cliffConfigPath`, `scopeAliases`: consumer value wins.
 */
export function mergeMonorepoConfig(
  discoveredPaths: string[],
  userConfig: ReleaseKitConfig | undefined,
): MonorepoReleaseConfig {
  // Build default workspaces from discovered paths
  let workspaces: WorkspaceConfig[] = discoveredPaths.map((workspacePath) => deriveWorkspaceConfig(workspacePath));

  // Detect duplicate tagPrefix values before filtering so exclusions cannot hide collisions.
  assertUniqueTagPrefixes(workspaces);

  // Apply workspace overrides from user config
  if (userConfig?.workspaces !== undefined) {
    const overrides = new Map(userConfig.workspaces.map((w) => [w.dir, w]));

    workspaces = workspaces
      .filter((w) => {
        const override = overrides.get(w.dir);
        return override?.shouldExclude !== true;
      })
      .map((w) => {
        const override = overrides.get(w.dir);
        if (override?.legacyIdentities === undefined) {
          return w;
        }
        assertLegacyIdentityDoesNotMatchCurrent(w.dir, w.name, w.tagPrefix, override.legacyIdentities);
        return { ...w, legacyIdentities: override.legacyIdentities.map((identity) => ({ ...identity })) };
      });
  }

  if (userConfig?.retiredPackages !== undefined) {
    assertRetiredPackagesDoNotCollideWithActive(workspaces, userConfig.retiredPackages);
  }

  // Merge workTypes
  const workTypes = resolveWorkTypes(userConfig?.workTypes);

  // versionPatterns: consumer replaces entirely
  const versionPatterns =
    userConfig?.versionPatterns === undefined ? { ...DEFAULT_VERSION_PATTERNS } : { ...userConfig.versionPatterns };

  const changelogJson = mergeChangelogJsonConfig(userConfig?.changelogJson);
  const releaseNotes = mergeReleaseNotesConfig(userConfig?.releaseNotes);

  const result: MonorepoReleaseConfig = {
    workspaces,
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
 * Throw when a workspace's `legacyIdentities` contains its current identity.
 *
 * An identity whose full `(name, tagPrefix)` tuple equals the current workspace's
 * `(name, tagPrefix)` is a guaranteed no-op duplicate, almost always a copy-paste mistake.
 * An entry whose `tagPrefix` matches but whose `name` differs is valid — it documents a prior
 * rename that reused the same tag shape.
 */
function assertLegacyIdentityDoesNotMatchCurrent(
  dir: string,
  currentName: string,
  currentTagPrefix: string,
  legacyIdentities: readonly LegacyIdentity[],
): void {
  for (const identity of legacyIdentities) {
    if (identity.name === currentName && identity.tagPrefix === currentTagPrefix) {
      throw new Error(
        `Workspace '${dir}': legacyIdentities must not match the current identity ` +
          `(name='${currentName}', tagPrefix='${currentTagPrefix}'). ` +
          'The current identity is always searched; listing it again is a no-op.',
      );
    }
  }
}

/**
 * Throw when a retired package's `tagPrefix` matches an active workspace's derived prefix.
 *
 * A retired package is, by definition, no longer hosted by any active workspace in this repo.
 * If its declared `tagPrefix` equals an active workspace's derived prefix, new tags from that
 * workspace would collide with the retired package's historical tags — and the retired entry
 * would be a misstatement of reality. Reject at load time with a workspace-naming error.
 */
function assertRetiredPackagesDoNotCollideWithActive(
  workspaces: readonly WorkspaceConfig[],
  retiredPackages: readonly RetiredPackage[],
): void {
  const workspaceByDerivedPrefix = new Map<string, WorkspaceConfig>();
  for (const workspace of workspaces) {
    workspaceByDerivedPrefix.set(workspace.tagPrefix, workspace);
  }

  for (const retired of retiredPackages) {
    const active = workspaceByDerivedPrefix.get(retired.tagPrefix);
    if (active !== undefined) {
      throw new Error(
        `retiredPackages: tagPrefix '${retired.tagPrefix}' collides with active workspace '${active.dir}' ` +
          `(derived prefix '${active.tagPrefix}'). A retired package's tagPrefix cannot belong to an active workspace.`,
      );
    }
  }
}

/**
 * Throw when two or more workspaces share the same `tagPrefix`.
 *
 * A collision means two workspaces would produce indistinguishable tags, breaking both tag
 * creation and tag resolution. The error lists every colliding workspace path so the author
 * can rename one of the conflicting `package.json` `name` fields.
 */
function assertUniqueTagPrefixes(workspaces: readonly WorkspaceConfig[]): void {
  const pathsByPrefix = new Map<string, string[]>();
  for (const workspace of workspaces) {
    const existing = pathsByPrefix.get(workspace.tagPrefix);
    if (existing === undefined) {
      pathsByPrefix.set(workspace.tagPrefix, [workspace.workspacePath]);
    } else {
      existing.push(workspace.workspacePath);
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
