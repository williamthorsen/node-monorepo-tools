import { readFileSync } from 'node:fs';

import type { WorkspaceDiscovery } from './discoverWorkspaces.ts';
import { isPublishableManifest } from './isPublishableManifest.ts';
import { mergeMonorepoConfig, mergeSinglePackageConfig, readRootPackageVersion } from './loadConfig.ts';
import type {
  CompositeTarget,
  MonorepoReleaseConfig,
  PackageTarget,
  ReleaseConfig,
  ReleaseKitConfig,
  ReleaseSettings,
  ReleaseTarget,
  ResolvedProjectConfig,
  WorkspaceConfig,
} from './types.ts';

/** Id of the composite target that a `project` block declares. A workspace `dir` is never empty, so ids cannot clash. */
export const PROJECT_TARGET_ID = '';

/** Id of the package target at the root of a single-package repo. */
export const SINGLE_PACKAGE_TARGET_ID = '.';

/** The targets of a release run, in the order in which `prepare` reports them, and the settings that they share. */
export interface ResolvedReleaseTargets {
  targets: ReleaseTarget[];
  settings: ReleaseSettings;
}

/**
 * Projects the user config onto the release targets of the discovered repo shape.
 *
 * A single-package repo yields one package target at the root. A monorepo yields one package target per retained
 * workspace, in discovery order, followed by a composite target for the `project` block when the config declares one.
 * Throws the config-merge errors of the shape, and when two targets share an id.
 */
export function resolveReleaseTargets(
  userConfig: ReleaseKitConfig | undefined,
  discovery: Exclude<WorkspaceDiscovery, { kind: 'empty' }>,
): ResolvedReleaseTargets {
  if (discovery.kind === 'single-package') {
    const config = mergeSinglePackageConfig(userConfig);
    return { targets: [buildSinglePackageTarget(config)], settings: pickSettings(config) };
  }

  return projectMonorepoConfig(mergeMonorepoConfig(discovery.packageDirs, userConfig, readRootPackageVersion()));
}

/** Reports whether the targets are those of a single-package repo: its root package target and nothing else. */
export function isSinglePackageTargets(targets: readonly ReleaseTarget[]): boolean {
  const [only] = targets;
  return targets.length === 1 && only?.kind === 'package' && only.workspaceDir === undefined;
}

/**
 * Projects a merged monorepo config onto its targets: one package target per workspace, in config order, then a
 * composite for the project block when the config has one. Throws when two targets share an id.
 */
export function projectMonorepoConfig(config: MonorepoReleaseConfig): ResolvedReleaseTargets {
  const targets: ReleaseTarget[] = config.workspaces.map(buildWorkspaceTarget);
  if (config.project !== undefined) {
    targets.push(buildProjectTarget(config.project, config.workspaces));
  }
  assertUniqueTargetIds(targets);

  return { targets, settings: pickSettings(config) };
}

// region | Helpers

/** Throws when two targets share an id, which would make `--only` and result attribution ambiguous. */
function assertUniqueTargetIds(targets: readonly ReleaseTarget[]): void {
  const seen = new Set<string>();
  for (const target of targets) {
    if (seen.has(target.id)) {
      throw new Error(`Duplicate release target id '${target.id}'`);
    }
    seen.add(target.id);
  }
}

/** Builds the composite target of a resolved `project` block, whose members are the retained workspaces. */
function buildProjectTarget(project: ResolvedProjectConfig, workspaces: readonly WorkspaceConfig[]): CompositeTarget {
  return {
    id: PROJECT_TARGET_ID,
    kind: 'composite',
    members: workspaces.map((workspace) => workspace.dir),
    tagPrefix: project.tagPrefix,
    versionFiles: ['./package.json'],
    changelogDir: '.',
    paths: [...project.paths],
    isPublishable: false,
  };
}

/** Builds the package target at the root of a single-package repo, which reads the whole history. */
function buildSinglePackageTarget(config: ReleaseConfig): PackageTarget {
  return {
    id: SINGLE_PACKAGE_TARGET_ID,
    kind: 'package',
    tagPrefix: config.tagPrefix,
    versionFiles: [...config.packageFiles],
    changelogDir: '.',
    packagePath: '.',
    isPublishable: readRootPublishability(),
  };
}

/** Builds the package target of a retained workspace. */
function buildWorkspaceTarget(workspace: WorkspaceConfig): PackageTarget {
  const target: PackageTarget = {
    id: workspace.dir,
    kind: 'package',
    packageName: workspace.name,
    tagPrefix: workspace.tagPrefix,
    versionFiles: [...workspace.packageFiles],
    changelogDir: workspace.workspacePath,
    paths: [...workspace.paths],
    isPublishable: workspace.isPublishable,
    packagePath: workspace.workspacePath,
    workspaceDir: workspace.dir,
  };
  if (workspace.legacyIdentities !== undefined) {
    target.legacyIdentities = workspace.legacyIdentities;
  }
  return target;
}

/** Copies the shared settings off a merged config, omitting each optional field that it lacks. */
function pickSettings(config: ReleaseSettings): ReleaseSettings {
  const { breakingPolicies, changelogJson, formatCommand, releaseNotes, scopeAliases, versionPatterns, workTypes } =
    config;
  return {
    changelogJson,
    releaseNotes,
    ...(breakingPolicies !== undefined && { breakingPolicies }),
    ...(formatCommand !== undefined && { formatCommand }),
    ...(scopeAliases !== undefined && { scopeAliases }),
    ...(versionPatterns !== undefined && { versionPatterns }),
    ...(workTypes !== undefined && { workTypes }),
  };
}

/**
 * Reads whether the root `package.json` is publishable. An unreadable manifest counts as private, so that the
 * release fails where it reads the version, which names the file.
 */
function readRootPublishability(): boolean {
  try {
    return isPublishableManifest(JSON.parse(readFileSync('package.json', 'utf8')));
  } catch {
    return false;
  }
}

// endregion | Helpers
