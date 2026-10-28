import type { LegacyIdentity, RetiredPackage } from './configSchema.ts';
import { ROOT_PACKAGE_JSON_PATH } from './loadConfig.ts';
import { getTargetName, normalizeWorkspacePath } from './resolveReleaseDeclaration.ts';
import type { DirectoryConfig, ResolvedProjectConfig, WorkspaceConfig } from './types.ts';

/**
 * Throws when a workspace's `legacyIdentities` contains its current identity.
 *
 * An identity whose full `(name, tagPrefix)` tuple equals the current workspace's
 * `(name, tagPrefix)` is a guaranteed no-op duplicate, almost always a copy-paste mistake.
 * An entry whose `tagPrefix` matches but whose `name` differs is valid: It documents a prior
 * rename that reused the same tag shape.
 */
export function assertLegacyIdentityDoesNotMatchCurrent(
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
 * Throws when a directory target shares its version file with another target, whose release would bump the same
 * `version` and write the same `CHANGELOG.md`: the repo root beside a composite, which the root `package.json` also
 * versions. Pairs of other targets keep the behavior that they had before directories existed, so the check covers
 * only pairs that include a directory.
 */
export function assertNoSharedVersionFiles(
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
export function assertNoTagPrefixCollisions(
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
  for (const [index, retiredPackage] of retiredEntries) {
    sources.push({
      prefix: retiredPackage.tagPrefix,
      label: `retiredPackages entry (name='${retiredPackage.name}')`,
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

  for (let aIndex = 0; aIndex < sources.length; aIndex++) {
    for (let bIndex = aIndex + 1; bIndex < sources.length; bIndex++) {
      const a = sources[aIndex];
      const b = sources[bIndex];
      if (a === undefined || b === undefined || a.owner === b.owner) continue;
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

/**
 * Throws when a retired package's `tagPrefix` matches an active workspace's derived prefix.
 *
 * A retired package is, by definition, no longer hosted by any active workspace in this repo.
 * If its declared `tagPrefix` equals an active workspace's derived prefix, new tags from that
 * workspace would collide with the retired package's historical tags.
 */
export function assertRetiredPackagesDoNotCollideWithActive(
  workspaces: readonly WorkspaceConfig[],
  retiredPackages: readonly RetiredPackage[],
): void {
  const workspaceByDerivedPrefix = new Map<string, WorkspaceConfig>();
  for (const workspace of workspaces) {
    workspaceByDerivedPrefix.set(workspace.tagPrefix, workspace);
  }

  for (const retiredPackage of retiredPackages) {
    const activeWorkspace = workspaceByDerivedPrefix.get(retiredPackage.tagPrefix);
    if (activeWorkspace !== undefined) {
      throw new Error(
        `retiredPackages: tagPrefix '${retiredPackage.tagPrefix}' collides with active workspace '${activeWorkspace.dir}' ` +
          `(derived prefix '${activeWorkspace.tagPrefix}'). A retired package's tagPrefix cannot belong to an active workspace.`,
      );
    }
  }
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
export function assertUniqueTagPrefixes(workspaces: readonly WorkspaceConfig[]): void {
  const pathsByPrefix = new Map<string, string[]>();
  for (const workspace of workspaces) {
    const existingPaths = pathsByPrefix.get(workspace.tagPrefix);
    if (existingPaths === undefined) {
      pathsByPrefix.set(workspace.tagPrefix, [workspace.workspacePath]);
    } else {
      existingPaths.push(workspace.workspacePath);
    }
  }

  for (const [prefix, paths] of pathsByPrefix) {
    if (paths.length > 1) {
      throw new Error(`Duplicate tag prefix '${prefix}' for workspaces: ${paths.join(', ')}`);
    }
  }
}

// region | Helpers

/** Reports whether the prefixes are equal or one starts with the other. */
function isPrefixCollision(a: string, b: string): boolean {
  return a === b || a.startsWith(b) || b.startsWith(a);
}

// endregion | Helpers
