import path from 'node:path';

import type { PathRelease, ProjectConfig, ReleaseKitConfig, WorkspaceConfig } from './types.ts';

/** The composite that a config declares, before the defaults and the root `package.json` check of `loadConfig`. */
export interface DeclaredComposite {
  /** Name that selects the composite; `undefined` for a `project` block. */
  name?: string;
  /** Target names of the members; `undefined` means every retained workspace. */
  members?: string[];
  /** Commit window; `undefined` means the union of the members' windows. */
  paths?: string[];
  tagPrefix?: string;
}

/** A directory that a `releases` entry declares as a target, before `loadConfig` checks it on disk. */
export interface DeclaredDirectory {
  /** Name of the target, its entry key. */
  name: string;
  /** Repo-relative POSIX path of the directory; `.` for the repo root. */
  path: string;
  /** Commit window; `undefined` for the repo root, whose window is the whole repo. */
  paths?: string[];
  tagPrefix?: string;
  legacyIdentities?: WorkspaceConfig['legacyIdentities'];
}

/** The release targets that a config declares over the discovered workspaces. */
export interface ReleaseDeclaration {
  /** Retained workspaces in discovery order, each with its target name and legacy identities applied. */
  retained: WorkspaceConfig[];
  /** Discovered workspaces that the config excludes, in discovery order. */
  excluded: WorkspaceConfig[];
  /** Directories that `releases` entries declare as targets, in config order. */
  directories: DeclaredDirectory[];
  composite?: DeclaredComposite;
}

/** Returns the name of a workspace's release target. */
export function getTargetName(workspace: WorkspaceConfig): string {
  return workspace.targetName ?? workspace.dir;
}

/** Normalizes a configured path to the repo-relative POSIX form of a discovered `workspacePath`. */
export function normalizeWorkspacePath(configuredPath: string): string {
  const normalized = path.posix.normalize(configuredPath.replaceAll('\\', '/'));
  return normalized.replace(/^\.\//, '').replace(/\/+$/, '');
}

/**
 * Projects the config's `releases` block, or its `workspaces` and `project` blocks, onto the discovered workspaces.
 *
 * Every discovered workspace is retained under its `dir` unless an entry excludes or renames it, and a `releases`
 * entry whose path isn't a discovered workspace declares a directory. Throws when a `releases` entry names a path
 * outside the repo, sets `tagPrefix` on a workspace, excludes a name that isn't a workspace's `dir`, repeats a path,
 * declares a second composite, or includes a target that is neither a retained workspace nor a directory.
 */
export function resolveReleaseDeclaration(
  workspaces: readonly WorkspaceConfig[],
  userConfig: ReleaseKitConfig | undefined,
): ReleaseDeclaration {
  if (userConfig?.releases !== undefined) {
    return resolveReleasesBlock(workspaces, userConfig.releases);
  }
  return resolveLegacyBlocks(workspaces, userConfig?.workspaces ?? [], userConfig?.project);
}

// region | Helpers

/** Copies a workspace, attaching the legacy identities of its entry when the entry declares any. */
function applyLegacyIdentities(
  workspace: WorkspaceConfig,
  legacyIdentities: WorkspaceConfig['legacyIdentities'],
): WorkspaceConfig {
  if (legacyIdentities === undefined) {
    return workspace;
  }
  return { ...workspace, legacyIdentities: legacyIdentities.map((identity) => ({ ...identity })) };
}

/** Records that the entry `name` declares `claimedPath`; throws when an earlier entry already declared it. */
function claimPath(
  entryByPath: Map<string, string>,
  name: string,
  claimedPath: string,
  kind: 'directory' | 'workspace',
): void {
  const claimedBy = entryByPath.get(claimedPath);
  if (claimedBy !== undefined) {
    throw new Error(
      `releases.${name}: ${kind} '${claimedPath}' is already declared by releases.${claimedBy}; declare each ${kind} once`,
    );
  }
  entryByPath.set(claimedPath, name);
}

/**
 * Builds the declaration of a directory target from its entry. Throws when the path leaves the repo, which a
 * changelog, a version file, and a commit window cannot.
 */
function declareDirectory(name: string, entry: PathRelease, normalizedPath: string): DeclaredDirectory {
  if (path.posix.isAbsolute(normalizedPath) || normalizedPath === '..' || normalizedPath.startsWith('../')) {
    throw new Error(`releases.${name}: path '${entry.path}' is outside the repo; declare a repo-relative directory`);
  }
  const isRoot = normalizedPath === '.' || normalizedPath === '';
  return {
    name,
    path: isRoot ? '.' : normalizedPath,
    ...(!isRoot && { paths: [`${normalizedPath}/**`] }),
    ...(entry.tagPrefix !== undefined && { tagPrefix: entry.tagPrefix }),
    ...(entry.legacyIdentities !== undefined && {
      legacyIdentities: entry.legacyIdentities.map((identity) => ({ ...identity })),
    }),
  };
}

/**
 * Returns the names and commit windows of the targets that a composite includes, in `includes` order. Throws on a name
 * that is the composite itself, an excluded workspace, or no target at all.
 */
function resolveCompositeMembers(
  composite: { name: string; includes: readonly string[] },
  retained: readonly WorkspaceConfig[],
  excluded: readonly WorkspaceConfig[],
  directories: readonly DeclaredDirectory[],
): Array<{ name: string; paths: readonly string[] | undefined }> {
  const membersByName = new Map<string, { name: string; paths: readonly string[] | undefined }>([
    ...retained.map(
      (workspace) => [getTargetName(workspace), { name: getTargetName(workspace), paths: workspace.paths }] as const,
    ),
    ...directories.map((directory) => [directory.name, { name: directory.name, paths: directory.paths }] as const),
  ]);
  return composite.includes.map((memberName) => {
    const member = membersByName.get(memberName);
    if (member !== undefined) {
      return member;
    }
    const label = `releases.${composite.name}.includes: '${memberName}'`;
    if (memberName === composite.name) {
      throw new Error(`${label} is the composite itself; a composite includes package and directory targets only`);
    }
    if (excluded.some((workspace) => workspace.dir === memberName)) {
      throw new Error(`${label} is excluded, so the composite cannot include it`);
    }
    throw new Error(`${label} is not a release target. Known targets: ${membersByName.keys().toArray().join(', ')}`);
  });
}

/** Projects the legacy `workspaces` overrides and `project` block, which match workspaces by `dir`. */
function resolveLegacyBlocks(
  workspaces: readonly WorkspaceConfig[],
  overrides: NonNullable<ReleaseKitConfig['workspaces']>,
  project: ProjectConfig | undefined,
): ReleaseDeclaration {
  const overridesByDir = new Map(overrides.map((override) => [override.dir, override]));
  const retained: WorkspaceConfig[] = [];
  const excluded: WorkspaceConfig[] = [];
  for (const workspace of workspaces) {
    const override = overridesByDir.get(workspace.dir);
    if (override?.shouldExclude === true) {
      excluded.push(workspace);
    } else {
      retained.push(applyLegacyIdentities(workspace, override?.legacyIdentities));
    }
  }

  const declaration: ReleaseDeclaration = { retained, excluded, directories: [] };
  if (project !== undefined) {
    declaration.composite = {
      ...(project.paths !== undefined && { paths: [...project.paths] }),
      ...(project.tagPrefix !== undefined && { tagPrefix: project.tagPrefix }),
    };
  }
  return declaration;
}

/**
 * Projects a `releases` block, whose entries match workspaces by path or, for an exclusion, by `dir`, and declare a
 * directory at any other path.
 */
function resolveReleasesBlock(
  workspaces: readonly WorkspaceConfig[],
  releases: NonNullable<ReleaseKitConfig['releases']>,
): ReleaseDeclaration {
  const workspaceByPath = new Map(workspaces.map((workspace) => [workspace.workspacePath, workspace]));
  const workspaceByDir = new Map(workspaces.map((workspace) => [workspace.dir, workspace]));
  const entryByPath = new Map<string, string>();
  const excludedPaths = new Set<string>();
  const renamed = new Map<string, WorkspaceConfig>();
  const directories: DeclaredDirectory[] = [];
  let composite: { name: string; includes: string[]; tagPrefix?: string } | undefined;

  for (const [name, entry] of Object.entries(releases)) {
    if (entry !== false && 'includes' in entry) {
      if (composite !== undefined) {
        throw new Error(
          `releases declares more than one composite ('${composite.name}', '${name}'); ` +
            'a composite is versioned by the root package.json, which only one composite can own',
        );
      }
      composite = {
        name,
        includes: entry.includes,
        ...(entry.tagPrefix !== undefined && { tagPrefix: entry.tagPrefix }),
      };
      continue;
    }

    if (entry === false) {
      const workspace = workspaceByDir.get(name);
      if (workspace === undefined) {
        throw new Error(
          `releases.${name}: false excludes a discovered workspace by its directory name, and no workspace is named '${name}'. ` +
            `Known workspaces: ${workspaceByDir.keys().toArray().join(', ')}`,
        );
      }
      claimPath(entryByPath, name, workspace.workspacePath, 'workspace');
      excludedPaths.add(workspace.workspacePath);
      continue;
    }

    const normalizedPath = normalizeWorkspacePath(entry.path);
    const workspace = workspaceByPath.get(normalizedPath);
    if (workspace === undefined) {
      const directory = declareDirectory(name, entry, normalizedPath);
      claimPath(entryByPath, name, directory.path, 'directory');
      directories.push(directory);
      continue;
    }

    if (entry.tagPrefix !== undefined) {
      throw new Error(
        `releases.${name}: tagPrefix applies only to a directory target, and '${workspace.workspacePath}' is a workspace, ` +
          "whose tag prefix derives from its package name; declare the workspace's earlier prefixes in legacyIdentities",
      );
    }
    claimPath(entryByPath, name, workspace.workspacePath, 'workspace');
    const named = applyLegacyIdentities(workspace, entry.legacyIdentities);
    renamed.set(workspace.workspacePath, name === workspace.dir ? named : { ...named, targetName: name });
  }

  const retained: WorkspaceConfig[] = [];
  const excluded: WorkspaceConfig[] = [];
  for (const workspace of workspaces) {
    if (excludedPaths.has(workspace.workspacePath)) {
      excluded.push(workspace);
    } else {
      retained.push(renamed.get(workspace.workspacePath) ?? workspace);
    }
  }

  const declaration: ReleaseDeclaration = { retained, excluded, directories };
  if (composite !== undefined) {
    const members = resolveCompositeMembers(composite, retained, excluded, directories);
    declaration.composite = {
      name: composite.name,
      members: members.map((member) => member.name),
      paths: members.flatMap((member) => member.paths ?? []),
      ...(composite.tagPrefix !== undefined && { tagPrefix: composite.tagPrefix }),
    };
  }
  return declaration;
}

// endregion | Helpers
