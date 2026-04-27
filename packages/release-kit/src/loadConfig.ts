import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_CHANGELOG_JSON_CONFIG,
  DEFAULT_PROJECT_TAG_PREFIX,
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
  ResolvedProjectConfig,
  RetiredPackage,
  WorkspaceConfig,
  WorkTypeConfig,
} from './types.ts';

/** Path of the root `package.json` consulted when validating a `project` block. */
export const ROOT_PACKAGE_JSON_PATH = 'package.json';

/**
 * Read the root `package.json` and return its `version` field.
 *
 * Returns `{ exists: false }` when the file is missing, `{ exists: true, version: undefined }`
 * when the file exists but has no `version` field, and `{ exists: true, version }` when both
 * are present. The caller (`mergeMonorepoConfig`) decides whether the situation is an error.
 */
export function readRootPackageVersion(): { exists: boolean; version: string | undefined } {
  const absolutePath = path.resolve(process.cwd(), ROOT_PACKAGE_JSON_PATH);
  if (!existsSync(absolutePath)) {
    return { exists: false, version: undefined };
  }

  let contents: string;
  try {
    contents = readFileSync(absolutePath, 'utf8');
  } catch (error: unknown) {
    throw new Error(
      `Failed to read root ${ROOT_PACKAGE_JSON_PATH}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error: unknown) {
    throw new Error(
      `Failed to parse root ${ROOT_PACKAGE_JSON_PATH}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(parsed)) {
    return { exists: true, version: undefined };
  }
  return { exists: true, version: typeof parsed.version === 'string' ? parsed.version : undefined };
}

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
 * Information about the root `package.json` passed into `mergeMonorepoConfig` when a
 * `project` block is configured. The async I/O lives in `readRootPackageVersion`; this
 * function stays a pure transformation.
 */
export interface RootPackageInfo {
  exists: boolean;
  version: string | undefined;
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
 * - `project`: present iff `userConfig.project` is declared. Resolves `tagPrefix` to
 *   `DEFAULT_PROJECT_TAG_PREFIX` when omitted. Requires `rootPackage` to be passed and to
 *   contain a valid `version` field; throws otherwise. The resolved prefix is included in
 *   the strict-prefix collision check across all workspace and retired-package prefixes.
 */
export function mergeMonorepoConfig(
  discoveredPaths: string[],
  userConfig: ReleaseKitConfig | undefined,
  rootPackage?: RootPackageInfo,
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

  // Resolve the project block (when present) and validate the root package.json prerequisites.
  const project = resolveProjectConfig(userConfig?.project, rootPackage);

  // Merge workTypes
  const workTypes = resolveWorkTypes(userConfig?.workTypes);

  // versionPatterns: consumer replaces entirely
  const versionPatterns =
    userConfig?.versionPatterns === undefined ? { ...DEFAULT_VERSION_PATTERNS } : { ...userConfig.versionPatterns };

  const changelogJson = mergeChangelogJsonConfig(userConfig?.changelogJson);
  const releaseNotes = mergeReleaseNotesConfig(userConfig?.releaseNotes);

  // Run the strict-prefix collision check across the union of every active, legacy, retired,
  // and (when configured) project tag prefix. Catches both the existing equality case and the
  // new strict-prefix-of-other case (`v` vs `vue-helpers-v`). Rejecting at load time prevents
  // `git describe --match=<prefix>*` from returning cross-matches at release time.
  assertNoTagPrefixCollisions(workspaces, userConfig?.retiredPackages, project);

  const result: MonorepoReleaseConfig = {
    workspaces,
    workTypes,
    versionPatterns,
    changelogJson,
    releaseNotes,
  };

  if (project !== undefined) {
    result.project = project;
  }

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
 *
 * Rejects a configured `project` block: project-level releases are a monorepo-only feature,
 * since the implicit "all non-excluded workspaces contribute" rule is meaningless in a
 * single-package repo.
 */
export function mergeSinglePackageConfig(userConfig: ReleaseKitConfig | undefined): ReleaseConfig {
  if (userConfig?.project !== undefined) {
    throw new Error('project block is not supported in single-package mode');
  }

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
 * Resolve the consumer-facing `project` block to a `ResolvedProjectConfig`.
 *
 * Returns `undefined` when the consumer did not declare a `project` block. Otherwise applies
 * defaults (`tagPrefix` → `DEFAULT_PROJECT_TAG_PREFIX`) and validates that the root
 * `package.json` exists with a `version` field — both prerequisites for emitting a project
 * tag and bumping a project version. Throws a clear, action-naming error otherwise.
 *
 * The root-package read itself happens upstream in `loadConfig` (which is async). This
 * function is a pure transformation and never touches the filesystem.
 */
function resolveProjectConfig(
  userProject: { tagPrefix?: string } | undefined,
  rootPackage: RootPackageInfo | undefined,
): ResolvedProjectConfig | undefined {
  if (userProject === undefined) {
    return undefined;
  }

  if (rootPackage === undefined || !rootPackage.exists) {
    throw new Error(
      `project block requires a root ${ROOT_PACKAGE_JSON_PATH}; create one with a 'version' field at the repo root`,
    );
  }
  if (rootPackage.version === undefined) {
    throw new Error(
      `project block requires root ${ROOT_PACKAGE_JSON_PATH} to have a 'version' field; add a 'version' field to your root package.json`,
    );
  }

  return { tagPrefix: userProject.tagPrefix ?? DEFAULT_PROJECT_TAG_PREFIX };
}

/**
 * Throw when any pair of declared tag prefixes from distinct owners is identical or one is a
 * strict prefix of the other.
 *
 * The strict-prefix rule extends the equality check to catch glob-overlap cases:
 * `git describe --match=<prefix>*` matches both `prefix` and `prefix-suffix`-style tags, so
 * a project prefix `'v'` would silently match a workspace prefix like `'vue-helpers-v'`.
 * Operates over the union of: every workspace's derived prefix, every workspace's declared
 * `legacyIdentities[].tagPrefix`, every `retiredPackages[].tagPrefix`, and (when configured)
 * the project's resolved `tagPrefix`. Within a single workspace, prefix overlap between the
 * derived prefix and a declared legacy identity is an intentional rename pattern (a prior
 * identity reusing the same tag shape under a different npm name), so collisions are only
 * checked across distinct owners. Each prefix is paired with a human-readable source label
 * so the error message points the consumer at the colliding declarations.
 */
function assertNoTagPrefixCollisions(
  workspaces: readonly WorkspaceConfig[],
  retiredPackages: readonly RetiredPackage[] | undefined,
  project: ResolvedProjectConfig | undefined,
): void {
  // region | Helpers
  interface PrefixSource {
    prefix: string;
    label: string;
    /** Stable identifier for the owning declaration (one workspace, one retired entry, project). */
    owner: string;
  }
  // endregion | Helpers

  const sources: PrefixSource[] = [];
  for (const workspace of workspaces) {
    const owner = `ws:${workspace.dir}`;
    sources.push({ prefix: workspace.tagPrefix, label: `workspace '${workspace.dir}'`, owner });
    for (const identity of workspace.legacyIdentities ?? []) {
      sources.push({
        prefix: identity.tagPrefix,
        label: `workspace '${workspace.dir}' legacyIdentities entry (name='${identity.name}')`,
        owner,
      });
    }
  }
  for (const [index, retired] of (retiredPackages ?? []).entries()) {
    sources.push({
      prefix: retired.tagPrefix,
      label: `retiredPackages entry (name='${retired.name}')`,
      owner: `retired:${index}`,
    });
  }
  if (project !== undefined) {
    sources.push({ prefix: project.tagPrefix, label: 'project', owner: 'project' });
  }

  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      const a = sources[i];
      const b = sources[j];
      if (a === undefined || b === undefined) continue;
      if (a.owner === b.owner) continue;
      if (isPrefixCollision(a.prefix, b.prefix)) {
        throw new Error(
          `Tag prefix collision: '${a.prefix}' (${a.label}) and '${b.prefix}' (${b.label}). ` +
            'One prefix is identical to or a strict prefix of the other; ' +
            'this would cause `git describe --match=<prefix>*` to return cross-matches.',
        );
      }
    }
  }
}

/** True when prefixes are equal or one starts with the other. */
function isPrefixCollision(a: string, b: string): boolean {
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/**
 * Throw when two or more workspaces share the same `tagPrefix`.
 *
 * A collision means two workspaces would produce indistinguishable tags, breaking both tag
 * creation and tag resolution. The error lists every colliding workspace path so the author
 * can rename one of the conflicting `package.json` `name` fields.
 *
 * This guards the pre-merge state when only workspaces have been derived. The broader
 * strict-prefix check across legacy, retired, and project prefixes runs later in
 * `assertNoTagPrefixCollisions`.
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
