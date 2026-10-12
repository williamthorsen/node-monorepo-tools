import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { chainError } from '@williamthorsen/toolbelt.errors/candidate';

import {
  DEFAULT_CHANGELOG_JSON_CONFIG,
  DEFAULT_PROJECT_TAG_PREFIX,
  DEFAULT_RELEASE_NOTES_CONFIG,
  DEFAULT_VERSION_PATTERNS,
  DEFAULT_WORK_TYPES,
} from './defaults.ts';
import { deriveDirectoryConfig } from './deriveDirectoryConfig.ts';
import { deriveWorkspaceConfig } from './deriveWorkspaceConfig.ts';
import {
  type DeclaredComposite,
  getTargetName,
  normalizeWorkspacePath,
  resolveReleaseDeclaration,
} from './resolveReleaseDeclaration.ts';
import { isRecord } from './typeGuards.ts';
import type {
  ChangelogJsonConfig,
  DirectoryConfig,
  LegacyIdentity,
  MonorepoReleaseConfig,
  ReleaseKitConfig,
  ReleaseNotesConfig,
  ReleaseSettings,
  ResolvedProjectConfig,
  RetiredPackage,
  WorkspaceConfig,
  WorkTypeConfig,
} from './types.ts';

/** Path of the root `package.json` consulted when validating a `project` block. */
export const ROOT_PACKAGE_JSON_PATH = 'package.json';

/**
 * Reads the root `package.json` and returns its `version` field.
 *
 * Returns `{ exists: false }` when the file is missing, `{ exists: true, version: undefined }`
 * when the file exists but does not have a `version` field, and `{ exists: true, version }`
 * when both are present; `mergeMonorepoConfig` decides whether the situation is an error.
 * Throws when the file cannot be read or parsed.
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
    throw chainError(`Failed to read root ${ROOT_PACKAGE_JSON_PATH}`, error);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error: unknown) {
    throw chainError(`Failed to parse root ${ROOT_PACKAGE_JSON_PATH}`, error);
  }

  if (!isRecord(parsed)) {
    return { exists: true, version: undefined };
  }
  return { exists: true, version: typeof parsed['version'] === 'string' ? parsed['version'] : undefined };
}

/** The path where the consumer-facing config file is expected. */
export const CONFIG_FILE_PATH = '.config/release-kit.config.ts';

/**
 * Loads the config file, returning the raw config object.
 *
 * `configPath` is resolved against the working directory, which the CLI sets to the repo root, and defaults to
 * `CONFIG_FILE_PATH`. The CLI resolves a `--config` value to an absolute path before passing it. An absent default
 * path returns `undefined`, because a repo that does not declare a config is a supported state; an absent named path
 * throws, because the caller asked for that file by name. Also throws when the file exists but cannot be
 * imported, or exports neither a default nor a named `config`.
 */
export async function loadConfig(configPath?: string): Promise<unknown> {
  const absoluteConfigPath = path.resolve(process.cwd(), configPath ?? CONFIG_FILE_PATH);

  if (!existsSync(absoluteConfigPath)) {
    if (configPath === undefined) {
      return undefined;
    }
    throw new Error(`Config file not found: ${absoluteConfigPath}`);
  }

  // Node type-strips `.ts` natively across this package's engines range, so the config does not need a transform
  // step or a loader dependency. `import()` takes a URL, not a path: A bare Windows path parses as a scheme.
  const imported: unknown = await import(pathToFileURL(absoluteConfigPath).href);

  // `isRecord` narrows the namespace for property access. Because reading an undeclared export off it yields
  // `undefined`, the fallback does not need a membership check.
  const resolved = isRecord(imported) ? (imported['default'] ?? imported['config']) : undefined;
  if (resolved === undefined) {
    throw new Error(
      'Config file must have a default export or a named `config` export (e.g., `export default { ... }` or `export const config = { ... }`)',
    );
  }

  return resolved;
}

/**
 * Information about the root `package.json` passed into `mergeMonorepoConfig` when a
 * `project` block is configured. `readRootPackageVersion` performs the read, so that
 * `mergeMonorepoConfig` does not perform any I/O.
 */
export interface RootPackageInfo {
  exists: boolean;
  version: string | undefined;
}

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

/**
 * Throws when a workspace's `legacyIdentities` contains its current identity.
 *
 * An identity whose full `(name, tagPrefix)` tuple equals the current workspace's
 * `(name, tagPrefix)` is a guaranteed no-op duplicate, almost always a copy-paste mistake.
 * An entry whose `tagPrefix` matches but whose `name` differs is valid: It documents a prior
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
 * Throws when a retired package's `tagPrefix` matches an active workspace's derived prefix.
 *
 * A retired package is, by definition, no longer hosted by any active workspace in this repo.
 * If its declared `tagPrefix` equals an active workspace's derived prefix, new tags from that
 * workspace would collide with the retired package's historical tags.
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
  if (rootPackage === undefined || !rootPackage.exists) {
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

/**
 * Throws when a directory target shares its version file with another target, whose release would bump the same
 * `version` and write the same `CHANGELOG.md`: the repo root beside a composite, which the root `package.json` also
 * versions. Pairs of other targets keep the behavior that they had before directories existed, so the check covers
 * only pairs that include a directory.
 */
function assertNoSharedVersionFiles(
  workspaces: readonly WorkspaceConfig[],
  directories: readonly DirectoryConfig[],
  project: ResolvedProjectConfig | undefined,
): void {
  const owners = [
    ...directories.map((directory) => ({
      label: `directory release '${directory.name}'`,
      versionFiles: [directory.versionFile],
    })),
    ...workspaces.map((workspace) => ({
      label: `workspace '${getTargetName(workspace)}'`,
      versionFiles: workspace.packageFiles.map(normalizeWorkspacePath),
    })),
    ...(project === undefined
      ? []
      : [
          {
            label: project.name === undefined ? 'the project release' : `composite release '${project.name}'`,
            versionFiles: [ROOT_PACKAGE_JSON_PATH],
          },
        ]),
  ];

  for (const [index, directory] of directories.entries()) {
    const peer = owners.slice(index + 1).find((owner) => owner.versionFiles.includes(directory.versionFile));
    if (peer !== undefined) {
      throw new Error(
        `directory release '${directory.name}' and ${peer.label} share the version file '${directory.versionFile}', ` +
          "so each release would overwrite the other's version and changelog; declare only one of them",
      );
    }
  }
}

/**
 * Throws when any pair of tag prefixes from distinct owners is identical or one is a strict
 * prefix of the other.
 *
 * A tag matches a prefix when the rest of its name is a complete SemVer version, so a prefix
 * `'pkg-'` matches `'pkg-1.0.0-v1.2.3'` through its pre-release suffix. The owners are each
 * workspace, each directory, each retired package, and the project. A workspace or a directory owns
 * both its current prefix and its legacy-identity prefixes, because a prior identity may reuse the
 * current tag shape under a different name.
 */
function assertNoTagPrefixCollisions(
  workspaces: readonly WorkspaceConfig[],
  directories: readonly DirectoryConfig[],
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
    const legacyIdentities = workspace.legacyIdentities ?? [];
    for (const identity of legacyIdentities) {
      sources.push({
        prefix: identity.tagPrefix,
        label: `workspace '${workspace.dir}' legacyIdentities entry (name='${identity.name}')`,
        owner,
      });
    }
  }
  for (const directory of directories) {
    const owner = `dir:${directory.path}`;
    sources.push({ prefix: directory.tagPrefix, label: `directory release '${directory.name}'`, owner });
    const legacyIdentities = directory.legacyIdentities ?? [];
    for (const identity of legacyIdentities) {
      sources.push({
        prefix: identity.tagPrefix,
        label: `directory release '${directory.name}' legacyIdentities entry (name='${identity.name}')`,
        owner,
      });
    }
  }
  const retiredEntries = (retiredPackages ?? []).entries();
  for (const [index, retired] of retiredEntries) {
    sources.push({
      prefix: retired.tagPrefix,
      label: `retiredPackages entry (name='${retired.name}')`,
      owner: `retired:${index}`,
    });
  }
  if (project !== undefined) {
    sources.push({
      prefix: project.tagPrefix,
      label: project.name === undefined ? 'project' : `composite release '${project.name}'`,
      owner: 'project',
    });
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
            'a tag under the longer prefix can then match the shorter one and be counted among its releases.',
        );
      }
    }
  }
}

/** Reports whether the prefixes are equal or one starts with the other. */
function isPrefixCollision(a: string, b: string): boolean {
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/**
 * Throws when two or more workspaces share the same `tagPrefix`.
 *
 * A collision means two workspaces would produce indistinguishable tags, breaking both tag
 * creation and tag resolution. The error lists every colliding workspace path so that the author
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

/** Merges user-provided release notes config with defaults. */
function mergeReleaseNotesConfig(partial: ReleaseKitConfig['releaseNotes']): ReleaseNotesConfig {
  if (partial === undefined) {
    return { ...DEFAULT_RELEASE_NOTES_CONFIG };
  }
  return {
    shouldInjectIntoReadme: partial.shouldInjectIntoReadme ?? DEFAULT_RELEASE_NOTES_CONFIG.shouldInjectIntoReadme,
  };
}
