import path from 'node:path';

import type { ProjectConfig, ReleaseKitConfig, WorkspaceConfig } from './types.ts';

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

/** The release targets that a config declares over the discovered workspaces. */
export interface ReleaseDeclaration {
  /** Retained workspaces in discovery order, each with its target name and legacy identities applied. */
  retained: WorkspaceConfig[];
  /** Discovered workspaces that the config excludes, in discovery order. */
  excluded: WorkspaceConfig[];
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
 * Every discovered workspace is retained under its `dir` unless an entry excludes or renames it. Throws when a
 * `releases` entry names a path that isn't a discovered workspace, excludes a name that isn't a workspace's `dir`,
 * repeats a workspace, declares a second composite, or includes a target that isn't a retained workspace.
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

/**
 * Returns the retained workspaces that a composite includes, in `includes` order. Throws on a name that is the
 * composite itself, an excluded workspace, or no target at all.
 */
function resolveCompositeMembers(
  composite: { name: string; includes: readonly string[] },
  retained: readonly WorkspaceConfig[],
  excluded: readonly WorkspaceConfig[],
): WorkspaceConfig[] {
  const retainedByName = new Map(retained.map((workspace) => [getTargetName(workspace), workspace]));
  return composite.includes.map((memberName) => {
    const member = retainedByName.get(memberName);
    if (member !== undefined) {
      return member;
    }
    const label = `releases.${composite.name}.includes: '${memberName}'`;
    if (memberName === composite.name) {
      throw new Error(`${label} is the composite itself; a composite includes package targets only`);
    }
    if (excluded.some((workspace) => workspace.dir === memberName)) {
      throw new Error(`${label} is excluded, so the composite cannot include it`);
    }
    throw new Error(`${label} is not a release target. Known targets: ${[...retainedByName.keys()].join(', ')}`);
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

  const declaration: ReleaseDeclaration = { retained, excluded };
  if (project !== undefined) {
    declaration.composite = {
      ...(project.paths !== undefined && { paths: [...project.paths] }),
      ...(project.tagPrefix !== undefined && { tagPrefix: project.tagPrefix }),
    };
  }
  return declaration;
}

/** Projects a `releases` block, whose entries match workspaces by path or, for an exclusion, by `dir`. */
function resolveReleasesBlock(
  workspaces: readonly WorkspaceConfig[],
  releases: NonNullable<ReleaseKitConfig['releases']>,
): ReleaseDeclaration {
  const workspaceByPath = new Map(workspaces.map((workspace) => [workspace.workspacePath, workspace]));
  const workspaceByDir = new Map(workspaces.map((workspace) => [workspace.dir, workspace]));
  const entryByWorkspacePath = new Map<string, string>();
  const excludedPaths = new Set<string>();
  const renamed = new Map<string, WorkspaceConfig>();
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

    const workspace =
      entry === false ? workspaceByDir.get(name) : workspaceByPath.get(normalizeWorkspacePath(entry.path));
    if (workspace === undefined) {
      throw new Error(
        entry === false
          ? `releases.${name}: false excludes a discovered workspace by its directory name, and no workspace is named '${name}'. ` +
              `Known workspaces: ${[...workspaceByDir.keys()].join(', ')}`
          : `releases.${name}: path '${entry.path}' is not a discovered workspace; ` +
              'releasing a directory without a package.json is not supported yet',
      );
    }

    const claimedBy = entryByWorkspacePath.get(workspace.workspacePath);
    if (claimedBy !== undefined) {
      throw new Error(
        `releases.${name}: workspace '${workspace.workspacePath}' is already declared by releases.${claimedBy}; ` +
          'declare each workspace once',
      );
    }
    entryByWorkspacePath.set(workspace.workspacePath, name);

    if (entry === false) {
      excludedPaths.add(workspace.workspacePath);
    } else {
      const named = applyLegacyIdentities(workspace, entry.legacyIdentities);
      renamed.set(workspace.workspacePath, name === workspace.dir ? named : { ...named, targetName: name });
    }
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

  const declaration: ReleaseDeclaration = { retained, excluded };
  if (composite !== undefined) {
    const members = resolveCompositeMembers(composite, retained, excluded);
    declaration.composite = {
      name: composite.name,
      members: members.map(getTargetName),
      paths: members.flatMap((member) => member.paths),
      ...(composite.tagPrefix !== undefined && { tagPrefix: composite.tagPrefix }),
    };
  }
  return declaration;
}

// endregion | Helpers
