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
 * - `workspaces`: Match overlay entries by `dir` against discovered list; `shouldExclude: true`
 *   removes the workspace; unlisted packages keep defaults.
 * - `workTypes`: Shallow merge; consumer entries override or add to defaults by key.
 * - `versionPatterns`: Consumer value replaces defaults entirely.
 * - Pass-through fields (see `applyOptionalPassthroughFields`): Consumer value wins.
 * - `project`: Present iff `userConfig.project` is declared. Resolves `tagPrefix` to
 *   `DEFAULT_PROJECT_TAG_PREFIX` and `paths` to the union of the retained workspaces' `paths`
 *   when omitted. Requires `rootPackage` to be passed and to contain a valid `version` field;
 *   throws otherwise. The resolved prefix is included in the strict-prefix collision check
 *   across all workspace and retired-package prefixes.
 */
export function mergeMonorepoConfig(
  discoveredPaths: string[],
  userConfig: ReleaseKitConfig | undefined,
  rootPackage?: RootPackageInfo,
): MonorepoReleaseConfig {
  let workspaces: WorkspaceConfig[] = discoveredPaths.map((workspacePath) => deriveWorkspaceConfig(workspacePath));

  // Detect duplicate tagPrefix values before filtering so that exclusions cannot hide collisions.
  assertUniqueTagPrefixes(workspaces);

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

  const project = resolveProjectConfig(userConfig?.project, rootPackage, workspaces);

  const workTypes = resolveWorkTypes(userConfig?.workTypes);

  const versionPatterns =
    userConfig?.versionPatterns === undefined ? { ...DEFAULT_VERSION_PATTERNS } : { ...userConfig.versionPatterns };

  const changelogJson = mergeChangelogJsonConfig(userConfig?.changelogJson);
  const releaseNotes = mergeReleaseNotesConfig(userConfig?.releaseNotes);

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

  applyOptionalPassthroughFields(result, userConfig);

  return result;
}

/**
 * Copies optional pass-through fields (`formatCommand`, `scopeAliases`, `breakingPolicies`) from
 * `userConfig` onto `result`, omitting any that are absent. Object-typed fields are stored by
 * reference.
 */
function applyOptionalPassthroughFields(
  result: {
    formatCommand?: string;
    scopeAliases?: Record<string, string>;
    breakingPolicies?: ReleaseKitConfig['breakingPolicies'];
  },
  userConfig: ReleaseKitConfig | undefined,
): void {
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
 * Resolves a final single-package config from an optional user config overlay.
 *
 * Rejects a configured `project` block: Project-level releases are a monorepo-only feature,
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
 * Resolves the consumer-facing `project` block to a `ResolvedProjectConfig`.
 *
 * Returns `undefined` when the consumer did not declare a `project` block. Otherwise applies
 * defaults (`tagPrefix` → `DEFAULT_PROJECT_TAG_PREFIX`, `paths` → the union of every contributing
 * workspace's `paths`) and validates that the root `package.json` exists with a `version` field,
 * both prerequisites for emitting a project tag and bumping a project version. Throws an
 * action-naming error otherwise.
 *
 * `workspaces` must be the post-exclusion set, so that the default `paths` cover only the
 * workspaces that contribute.
 */
function resolveProjectConfig(
  userProject: ReleaseKitConfig['project'],
  rootPackage: RootPackageInfo | undefined,
  workspaces: readonly WorkspaceConfig[],
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

  return {
    paths: userProject.paths ?? workspaces.flatMap((workspace) => workspace.paths),
    tagPrefix: userProject.tagPrefix ?? DEFAULT_PROJECT_TAG_PREFIX,
  };
}

/**
 * Throws when any pair of tag prefixes from distinct owners is identical or one is a strict
 * prefix of the other.
 *
 * A tag matches a prefix when its name continues with a digit after it, so a project prefix
 * `'v'` matches `'v11y-check-v1.0.0'`. The owners are each workspace, each retired package, and
 * the project. A workspace owns both its derived prefix and its legacy-identity prefixes, because
 * a prior identity may reuse the current tag shape under a different npm name.
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
    const legacyIdentities = workspace.legacyIdentities ?? [];
    for (const identity of legacyIdentities) {
      sources.push({
        prefix: identity.tagPrefix,
        label: `workspace '${workspace.dir}' legacyIdentities entry (name='${identity.name}')`,
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
