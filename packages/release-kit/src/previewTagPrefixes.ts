import { basename } from 'node:path';

import { UserError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import type { LegacyIdentity, ReleaseKitConfig, RetiredPackage } from './configSchema.ts';
import { DEFAULT_PROJECT_TAG_PREFIX } from './defaults.ts';
import { deriveDirectoryConfig } from './deriveDirectoryConfig.ts';
import { deriveWorkspaceConfig } from './deriveWorkspaceConfig.ts';
import { detectUndeclaredTagPrefixes, type UndeclaredTagPrefix } from './detectUndeclaredTagPrefixes.ts';
import { describeEmptyWorkspace, discoverWorkspaces } from './discoverWorkspaces.ts';
import { type Git, realGit } from './git.ts';
import { matchesTagPrefix } from './matchesTagPrefix.ts';
import { normalizeWorkspacePath } from './resolveReleaseDeclaration.ts';

/** One workspace's or directory target's preview row in the tag-prefix preview. */
export interface TagPrefixPreviewRow {
  /** Directory path relative to the repo root (e.g., `packages/core`). */
  workspacePath: string;
  /** Directory basename (e.g., `core`). */
  dir: string;
  /**
   * The workspace's `package.json` name or the directory target's `releases` key; `null` when a workspace's derivation
   * failed.
   */
  name: string | null;
  /** The derived tag prefix, or `null` when derivation failed. */
  derivedPrefix: string | null;
  /** Human-readable reason derivation failed, or `null` when it succeeded. */
  derivationError: string | null;
  /** Count of tags matching the derived prefix; `0` when derivation failed or the repo lacks matching tags. */
  derivedTagCount: number;
  /** One entry per declared legacy prefix, with its current tag count. */
  legacyEntries: LegacyTagPrefixEntry[];
}

/** A single declared legacy identity's prefix and its tag count. */
export interface LegacyTagPrefixEntry {
  name: string;
  prefix: string;
  tagCount: number;
}

/** A declared retired package plus its current tag count. */
export interface RetiredPackagePreviewEntry {
  name: string;
  tagPrefix: string;
  successor?: string;
  tagCount: number;
}

/** A tag-prefix collision between two or more workspaces. */
export interface TagPrefixCollision {
  tagPrefix: string;
  workspacePaths: string[];
}

/** Aggregate preview of tag-prefix state across all workspaces. */
export interface TagPrefixPreview {
  workspaces: TagPrefixPreviewRow[];
  collisions: TagPrefixCollision[];
  undeclaredCandidates: UndeclaredTagPrefix[];
  retiredPackages: RetiredPackagePreviewEntry[];
}

/**
 * Builds a structured preview of tag-prefix state for every discovered workspace and every directory that the
 * `releases` block declares.
 *
 * Records a workspace's derivation error rather than aborting. For a repo releasing as a single package, the
 * preview doesn't contain any rows; for one declaring patterns that don't resolve to any package, the function
 * throws, because the manifest then needs repairing and a clean table would hide that. Also reports the legacy
 * prefixes that the validated `config` declares per workspace, undeclared candidate prefixes among the local git
 * tags, and collisions across the successfully derived prefixes. A declared composite's tag prefix counts as known, so
 * that its tags are not reported as undeclared.
 */
export function previewTagPrefixes(config?: ReleaseKitConfig, git: Git = realGit): TagPrefixPreview {
  const workspace = discoverWorkspaces();
  if (workspace.kind === 'empty') {
    throw new UserError(`No workspace package to preview. ${describeEmptyWorkspace(workspace)}`);
  }

  const workspacePaths = workspace.kind === 'packages' ? workspace.packageDirs : [];
  const overridesByPath = buildOverrideMap(config, workspacePaths);

  const workspaces: TagPrefixPreviewRow[] = [
    ...Array.from(workspacePaths, (workspacePath) =>
      buildPreviewRow(workspacePath, null, () => deriveWorkspaceConfig(workspacePath), overridesByPath, git),
    ),
    ...buildDirectoryRows(config, workspacePaths, overridesByPath, git),
  ];

  const retiredPackages = buildRetiredPreviewEntries(config?.retiredPackages ?? [], git);

  const collisions = detectCollisions(workspaces);
  const knownPrefixes = collectKnownPrefixes(workspaces, retiredPackages, findCompositeTagPrefix(config));
  const undeclaredCandidates = detectUndeclaredTagPrefixes(knownPrefixes, git);

  return { workspaces, collisions, undeclaredCandidates, retiredPackages };
}

/**
 * Builds a `workspacePath -> legacyIdentities` lookup from a validated config: `workspaces` overrides match the
 * discovered workspaces by `dir`, and `releases` package entries match by path.
 */
function buildOverrideMap(
  config: ReleaseKitConfig | undefined,
  workspacePaths: readonly string[],
): Map<string, LegacyIdentity[]> {
  const map = new Map<string, LegacyIdentity[]>();
  const workspaceEntries = config?.workspaces ?? [];
  for (const { dir, legacyIdentities } of workspaceEntries) {
    if (legacyIdentities === undefined) continue;
    for (const workspacePath of workspacePaths) {
      if (basename(workspacePath) === dir) {
        map.set(workspacePath, legacyIdentities);
      }
    }
  }
  const releaseEntries = Object.values(config?.releases ?? {});
  for (const entry of releaseEntries) {
    if (entry !== false && 'path' in entry && entry.legacyIdentities !== undefined) {
      map.set(normalizeWorkspacePath(entry.path), entry.legacyIdentities);
    }
  }
  return map;
}

/**
 * Builds a preview row for each `releases` path entry that doesn't name a discovered workspace, which declares a
 * directory target.
 */
function buildDirectoryRows(
  config: ReleaseKitConfig | undefined,
  workspacePaths: readonly string[],
  overridesByPath: Map<string, LegacyIdentity[]>,
  git: Git,
): TagPrefixPreviewRow[] {
  const discoveredPaths = new Set(workspacePaths);
  return Object.entries(config?.releases ?? {}).flatMap(([name, entry]) => {
    if (entry === false || !('path' in entry)) return [];
    const directoryPath = normalizeWorkspacePath(entry.path);
    if (discoveredPaths.has(directoryPath)) return [];
    const declaredDirectory = {
      name,
      path: directoryPath,
      ...(entry.tagPrefix !== undefined && { tagPrefix: entry.tagPrefix }),
    };
    return [buildPreviewRow(directoryPath, name, () => deriveDirectoryConfig(declaredDirectory), overridesByPath, git)];
  });
}

/**
 * Constructs a single target's preview row, catching a failure of `deriveTarget` per row. `knownName` is the name that
 * the title keeps when derivation fails.
 */
function buildPreviewRow(
  workspacePath: string,
  knownName: string | null,
  deriveTarget: () => { name: string; tagPrefix: string },
  overridesByPath: Map<string, LegacyIdentity[]>,
  git: Git,
): TagPrefixPreviewRow {
  const dir = basename(workspacePath);
  let name = knownName;
  let derivedPrefix: string | null = null;
  let derivationError: string | null = null;
  try {
    const target = deriveTarget();
    name = target.name;
    derivedPrefix = target.tagPrefix;
  } catch (error: unknown) {
    derivationError = describeError(error);
  }

  const derivedTagCount = derivedPrefix === null ? 0 : countTagsMatching(derivedPrefix, git);

  const declaredIdentities = overridesByPath.get(workspacePath) ?? [];
  const legacyEntries: LegacyTagPrefixEntry[] = declaredIdentities.map((identity) => ({
    name: identity.name,
    prefix: identity.tagPrefix,
    tagCount: countTagsMatching(identity.tagPrefix, git),
  }));

  return {
    workspacePath,
    dir,
    name,
    derivedPrefix,
    derivationError,
    derivedTagCount,
    legacyEntries,
  };
}

/** Returns the number of local git tags that count as releases under the given prefix. */
function countTagsMatching(prefix: string, git: Git): number {
  try {
    return git.listTags(`${prefix}*`).filter((tag) => matchesTagPrefix(tag, [prefix])).length;
  } catch {
    return 0;
  }
}

/** Identifies cross-workspace derived-prefix collisions, excluding rows with failed derivation. */
function detectCollisions(rows: readonly TagPrefixPreviewRow[]): TagPrefixCollision[] {
  const pathsByPrefix = new Map<string, string[]>();
  for (const row of rows) {
    if (row.derivedPrefix === null) continue;
    const existingPaths = pathsByPrefix.get(row.derivedPrefix);
    if (existingPaths === undefined) {
      pathsByPrefix.set(row.derivedPrefix, [row.workspacePath]);
    } else {
      existingPaths.push(row.workspacePath);
    }
  }

  const collisions: TagPrefixCollision[] = [];
  for (const [tagPrefix, workspacePaths] of pathsByPrefix) {
    if (workspacePaths.length > 1) {
      collisions.push({ tagPrefix, workspacePaths });
    }
  }
  return collisions;
}

/**
 * Collects the union of successfully-derived prefixes, declared legacy prefixes, retired prefixes, and the composite's
 * prefix when the config declares one.
 */
function collectKnownPrefixes(
  rows: readonly TagPrefixPreviewRow[],
  retiredPackages: readonly RetiredPackagePreviewEntry[],
  compositeTagPrefix: string | undefined,
): string[] {
  const knownPrefixes = new Set<string>();
  for (const row of rows) {
    if (row.derivedPrefix !== null) knownPrefixes.add(row.derivedPrefix);
    for (const entry of row.legacyEntries) {
      knownPrefixes.add(entry.prefix);
    }
  }
  for (const retiredPackage of retiredPackages) {
    knownPrefixes.add(retiredPackage.tagPrefix);
  }
  if (compositeTagPrefix !== undefined) knownPrefixes.add(compositeTagPrefix);
  return [...knownPrefixes];
}

/** Builds preview entries for each declared retired package, attaching current tag counts. */
function buildRetiredPreviewEntries(
  retiredPackages: readonly RetiredPackage[],
  git: Git,
): RetiredPackagePreviewEntry[] {
  return retiredPackages.map((retiredPackage) => ({
    name: retiredPackage.name,
    tagPrefix: retiredPackage.tagPrefix,
    tagCount: countTagsMatching(retiredPackage.tagPrefix, git),
    ...(retiredPackage.successor !== undefined && { successor: retiredPackage.successor }),
  }));
}

/**
 * Returns the tag prefix of the composite that a validated config declares, through a `project` block or a `releases`
 * composite entry, with the default applied; `undefined` when the config declares neither.
 */
function findCompositeTagPrefix(config: ReleaseKitConfig | undefined): string | undefined {
  if (config?.project !== undefined) {
    return config.project.tagPrefix ?? DEFAULT_PROJECT_TAG_PREFIX;
  }
  const releaseEntries = Object.values(config?.releases ?? {});
  for (const entry of releaseEntries) {
    if (entry !== false && 'includes' in entry) {
      return entry.tagPrefix ?? DEFAULT_PROJECT_TAG_PREFIX;
    }
  }
  return undefined;
}
