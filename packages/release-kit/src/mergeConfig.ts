import type { ReleaseKitConfig } from './configSchema.ts';
import {
  DEFAULT_CHANGELOG_JSON_CONFIG,
  DEFAULT_PROJECT_TAG_PREFIX,
  DEFAULT_RELEASE_NOTES_CONFIG,
  DEFAULT_VERSION_PATTERNS,
  DEFAULT_WORK_TYPES,
} from './defaults.ts';
import { deriveDirectoryConfig } from './deriveDirectoryConfig.ts';
import { deriveWorkspaceConfig } from './deriveWorkspaceConfig.ts';
import { ROOT_PACKAGE_JSON_PATH } from './loadConfig.ts';
import {
  assertLegacyIdentityDoesNotMatchCurrent,
  assertNoSharedVersionFiles,
  assertNoTagPrefixCollisions,
  assertRetiredPackagesDoNotCollideWithActive,
  assertUniqueTagPrefixes,
} from './monorepoConfigAssertions.ts';
import { type DeclaredComposite, resolveReleaseDeclaration } from './resolveReleaseDeclaration.ts';
import type {
  ChangelogJsonConfig,
  MonorepoReleaseConfig,
  ReleaseNotesConfig,
  ReleaseSettings,
  ResolvedProjectConfig,
  WorkspaceConfig,
  WorkTypeConfig,
} from './types.ts';

/**
 * Resolves a final monorepo config from discovered workspaces and an optional user config overlay.
 *
 * Merging rules:
 * - Release targets: `resolveReleaseDeclaration` projects the `releases` block, or the `workspaces` overrides and the
 *   `project` block, onto the discovered workspaces. Excluded workspaces move to `excludedWorkspaces`, and the
 *   directories that `releases` declares resolve through `deriveDirectoryConfig` into `directories`, which must not
 *   share a version file with any other target.
 * - `workTypes`: Shallow merge; consumer entries override or add to defaults by key.
 * - `versionPatterns`: Consumer value replaces defaults entirely.
 * - Pass-through fields (see `applyOptionalPassthroughFields`): Consumer value wins.
 * - `project`: Present iff the config declares a composite. Resolves `tagPrefix` to `DEFAULT_PROJECT_TAG_PREFIX` and
 *   `paths` to the union of its members' `paths` when omitted. Requires `rootPackage` to be passed and to contain a
 *   valid `version` field; throws otherwise. The resolved prefix is included in the strict-prefix collision check
 *   across all workspace and retired-package prefixes.
 */
export function mergeMonorepoConfig(
  discoveredPaths: string[],
  userConfig: ReleaseKitConfig | undefined,
  rootPackage?: RootPackageInfo,
): MonorepoReleaseConfig {
  const discovered = discoveredPaths.map((workspacePath) => deriveWorkspaceConfig(workspacePath));

  // Detect duplicate tagPrefix values before filtering so that exclusions cannot hide collisions.
  assertUniqueTagPrefixes(discovered);

  const {
    retained: workspaces,
    excluded,
    directories: declaredDirectories,
    composite,
  } = resolveReleaseDeclaration(discovered, userConfig);
  const directories = declaredDirectories.map((declared) => deriveDirectoryConfig(declared));
  for (const workspace of workspaces) {
    if (workspace.legacyIdentities !== undefined) {
      assertLegacyIdentityDoesNotMatchCurrent(
        workspace.dir,
        workspace.name,
        workspace.tagPrefix,
        workspace.legacyIdentities,
      );
    }
  }

  if (userConfig?.retiredPackages !== undefined) {
    assertRetiredPackagesDoNotCollideWithActive(workspaces, userConfig.retiredPackages);
  }

  const project = resolveProjectConfig(composite, rootPackage, workspaces);

  const workTypes = resolveWorkTypes(userConfig?.workTypes);

  const versionPatterns =
    userConfig?.versionPatterns === undefined ? { ...DEFAULT_VERSION_PATTERNS } : { ...userConfig.versionPatterns };

  const changelogJson = mergeChangelogJsonConfig(userConfig?.changelogJson);
  const releaseNotes = mergeReleaseNotesConfig(userConfig?.releaseNotes);

  // Check shared version files first: A root directory beside a composite also collides on `v`, and the shared file
  // names the cause.
  assertNoSharedVersionFiles(workspaces, directories, project);
  assertNoTagPrefixCollisions(workspaces, directories, userConfig?.retiredPackages, project);

  const result: MonorepoReleaseConfig = {
    workspaces,
    workTypes,
    versionPatterns,
    changelogJson,
    releaseNotes,
  };

  if (excluded.length > 0) {
    result.excludedWorkspaces = excluded;
  }
  if (directories.length > 0) {
    result.directories = directories;
  }
  if (project !== undefined) {
    result.project = project;
  }

  applyOptionalPassthroughFields(result, userConfig);

  return result;
}

/**
 * Resolves the release settings of a single-package repo from an optional user config overlay.
 *
 * Rejects a configured `project` or `releases` block: Both declare the targets of a monorepo, and a single-package
 * repo has one target, its root package.
 */
export function mergeSinglePackageConfig(userConfig: ReleaseKitConfig | undefined): ReleaseSettings {
  if (userConfig?.project !== undefined) {
    throw new Error('project block is not supported in single-package mode');
  }
  if (userConfig?.releases !== undefined) {
    throw new Error('releases block is not supported in single-package mode');
  }

  const workTypes = resolveWorkTypes(userConfig?.workTypes);

  const versionPatterns =
    userConfig?.versionPatterns === undefined ? { ...DEFAULT_VERSION_PATTERNS } : { ...userConfig.versionPatterns };

  const changelogJson = mergeChangelogJsonConfig(userConfig?.changelogJson);
  const releaseNotes = mergeReleaseNotesConfig(userConfig?.releaseNotes);

  const result: ReleaseSettings = {
    workTypes,
    versionPatterns,
    changelogJson,
    releaseNotes,
  };

  applyOptionalPassthroughFields(result, userConfig);

  return result;
}

/**
 * Merges consumer work-type overrides onto `DEFAULT_WORK_TYPES`.
 *
 * Preserves the declaration order of defaults; net-new consumer keys append at the end.
 */
export function resolveWorkTypes(userWorkTypes?: ReleaseKitConfig['workTypes']): Record<string, WorkTypeConfig> {
  return userWorkTypes === undefined ? { ...DEFAULT_WORK_TYPES } : { ...DEFAULT_WORK_TYPES, ...userWorkTypes };
}

/**
 * Information about the root `package.json` passed into `mergeMonorepoConfig` when a
 * `project` block is configured. `readRootPackageVersion` performs the read, so that
 * `mergeMonorepoConfig` does not perform any I/O.
 */
export interface RootPackageInfo {
  doesExist: boolean;
  version: string | undefined;
}

// region | Helpers

/**
 * Copies optional pass-through fields (`changelogMarkdown`, `formatCommand`, `scopeAliases`, `breakingPolicies`)
 * from `userConfig` onto `result`, omitting any that are absent. Object-typed fields are stored by reference.
 */
function applyOptionalPassthroughFields(
  result: {
    changelogMarkdown?: ReleaseKitConfig['changelogMarkdown'];
    formatCommand?: string;
    scopeAliases?: Record<string, string>;
    breakingPolicies?: ReleaseKitConfig['breakingPolicies'];
  },
  userConfig: ReleaseKitConfig | undefined,
): void {
  if (userConfig?.changelogMarkdown !== undefined) {
    result.changelogMarkdown = userConfig.changelogMarkdown;
  }
  if (userConfig?.formatCommand !== undefined) {
    result.formatCommand = userConfig.formatCommand;
  }
  if (userConfig?.scopeAliases !== undefined) {
    result.scopeAliases = userConfig.scopeAliases;
  }
  if (userConfig?.breakingPolicies !== undefined) {
    result.breakingPolicies = userConfig.breakingPolicies;
  }
}

/** Merges user-provided changelog JSON config with defaults. */
function mergeChangelogJsonConfig(partial: ReleaseKitConfig['changelogJson']): ChangelogJsonConfig {
  if (partial === undefined) {
    return { ...DEFAULT_CHANGELOG_JSON_CONFIG };
  }
  return {
    enabled: partial.enabled ?? DEFAULT_CHANGELOG_JSON_CONFIG.enabled,
    outputPath: partial.outputPath ?? DEFAULT_CHANGELOG_JSON_CONFIG.outputPath,
    devOnlySections: partial.devOnlySections ?? [...DEFAULT_CHANGELOG_JSON_CONFIG.devOnlySections],
  };
}

/** Merges user-provided release notes config with defaults. */
function mergeReleaseNotesConfig(partial: ReleaseKitConfig['releaseNotes']): ReleaseNotesConfig {
  if (partial === undefined) {
    return { ...DEFAULT_RELEASE_NOTES_CONFIG };
  }
  return {
    shouldInjectIntoReadme: partial.shouldInjectIntoReadme ?? DEFAULT_RELEASE_NOTES_CONFIG.shouldInjectIntoReadme,
  };
}

/**
 * Resolves the declared composite to a `ResolvedProjectConfig`.
 *
 * Returns `undefined` when the config does not declare a composite. Otherwise applies defaults (`tagPrefix` →
 * `DEFAULT_PROJECT_TAG_PREFIX`, `paths` → the union of every retained workspace's `paths`, which a `releases`
 * composite has already narrowed to its members) and validates that the root `package.json` exists with a `version`
 * field, both prerequisites for emitting a composite tag and bumping its version. Throws an action-naming error
 * otherwise.
 *
 * `workspaces` must be the post-exclusion set, so that the default `paths` cover only the workspaces that contribute.
 */
function resolveProjectConfig(
  composite: DeclaredComposite | undefined,
  rootPackage: RootPackageInfo | undefined,
  workspaces: readonly WorkspaceConfig[],
): ResolvedProjectConfig | undefined {
  if (composite === undefined) {
    return undefined;
  }

  const subject = composite.name === undefined ? 'project block' : `composite release '${composite.name}'`;
  if (rootPackage === undefined || !rootPackage.doesExist) {
    throw new Error(
      `${subject} requires a root ${ROOT_PACKAGE_JSON_PATH}; create one with a 'version' field at the repo root`,
    );
  }
  if (rootPackage.version === undefined) {
    throw new Error(
      `${subject} requires root ${ROOT_PACKAGE_JSON_PATH} to have a 'version' field; add a 'version' field to the root package.json`,
    );
  }

  return {
    paths: composite.paths ?? workspaces.flatMap((workspace) => workspace.paths),
    tagPrefix: composite.tagPrefix ?? DEFAULT_PROJECT_TAG_PREFIX,
    ...(composite.name !== undefined && { name: composite.name }),
    ...(composite.members !== undefined && { members: composite.members }),
  };
}

// endregion | Helpers
