import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

import { GIT_OUTPUT_LIMIT } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { deriveWorkspaceConfig } from './deriveWorkspaceConfig.ts';
import { detectUndeclaredTagPrefixes, type UndeclaredTagPrefix } from './detectUndeclaredTagPrefixes.ts';
import { describeEmptyWorkspace, discoverWorkspaces } from './discoverWorkspaces.ts';
import type { LegacyIdentity, ReleaseKitConfig, RetiredPackage } from './types.ts';

/** One workspace's preview row in the tag-prefix preview. */
export interface TagPrefixPreviewRow {
  /** Workspace-relative directory path (e.g., `packages/core`). */
  workspacePath: string;
  /** Directory basename (e.g., `core`). */
  dir: string;
  /** The derived tag prefix, or `null` when derivation failed. */
  derivedPrefix: string | null;
  /** Human-readable reason derivation failed, or `null` when it succeeded. */
  derivationError: string | null;
  /** Count of tags matching the derived prefix; `0` when derivation failed or no tags exist. */
  derivedTagCount: number;
  /** One entry per declared legacy prefix, with its current tag count. */
  legacyEntries: LegacyTagPrefixEntry[];
}

/** A single declared legacy prefix and its tag count. */
export interface LegacyTagPrefixEntry {
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
 * Build a structured preview of tag-prefix state for every discovered workspace.
 *
 * Derives each workspace's tag prefix via `deriveWorkspaceConfig()`, recording the derivation error on failure
 * rather than aborting. A repo declaring no workspace previews no row; one whose patterns resolve to no package
 * throws, because the manifest is then what needs repairing and a clean table would hide that.
 * Reads the already-validated `config` to surface declared legacy prefixes per workspace, scans local
 * git tags for undeclared candidate prefixes via `detectUndeclaredTagPrefixes`, and reports collisions
 * across successfully-derived prefixes.
 */
export function previewTagPrefixes(config?: ReleaseKitConfig): TagPrefixPreview {
  const workspace = discoverWorkspaces();
  if (workspace.kind === 'empty') {
    throw new Error(`No workspace package to preview. ${describeEmptyWorkspace(workspace)}`);
  }

  const workspacePaths = workspace.kind === 'packages' ? workspace.packageDirs : [];
  const overridesByDir = buildOverrideMap(config);

  const workspaces: TagPrefixPreviewRow[] = Array.from(workspacePaths, (workspacePath) =>
    buildPreviewRow(workspacePath, overridesByDir),
  );

  const retiredPackages = buildRetiredPreviewEntries(config?.retiredPackages ?? []);

  const collisions = detectCollisions(workspaces);
  const knownPrefixes = collectKnownPrefixes(workspaces, retiredPackages);
  const undeclaredCandidates = detectUndeclaredTagPrefixes(knownPrefixes);

  return { workspaces, collisions, undeclaredCandidates, retiredPackages };
}

/** Build a `dir -> legacyIdentities` lookup map from a validated config. */
function buildOverrideMap(config: ReleaseKitConfig | undefined): Map<string, LegacyIdentity[]> {
  const map = new Map<string, LegacyIdentity[]>();
  if (config?.workspaces === undefined) return map;
  for (const entry of config.workspaces) {
    if (entry.legacyIdentities !== undefined) {
      map.set(entry.dir, entry.legacyIdentities);
    }
  }
  return map;
}

/** Construct a single workspace's preview row, catching derivation failures per-workspace. */
function buildPreviewRow(workspacePath: string, overridesByDir: Map<string, LegacyIdentity[]>): TagPrefixPreviewRow {
  const dir = basename(workspacePath);
  let derivedPrefix: string | null = null;
  let derivationError: string | null = null;
  try {
    derivedPrefix = deriveWorkspaceConfig(workspacePath).tagPrefix;
  } catch (error: unknown) {
    derivationError = describeError(error);
  }

  const derivedTagCount = derivedPrefix === null ? 0 : countTagsMatching(derivedPrefix);

  const declaredIdentities = overridesByDir.get(dir) ?? [];
  const legacyEntries: LegacyTagPrefixEntry[] = declaredIdentities.map((identity) => ({
    prefix: identity.tagPrefix,
    tagCount: countTagsMatching(identity.tagPrefix),
  }));

  return {
    workspacePath,
    dir,
    derivedPrefix,
    derivationError,
    derivedTagCount,
    legacyEntries,
  };
}

/** Return the number of local git tags whose name starts with the given prefix. */
function countTagsMatching(prefix: string): number {
  try {
    const output = execFileSync('git', ['tag', '--list', `${prefix}*`], {
      encoding: 'utf8',
      maxBuffer: GIT_OUTPUT_LIMIT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.split('\n').filter((line) => line.trim() !== '').length;
  } catch {
    return 0;
  }
}

/** Identify cross-workspace derived-prefix collisions, excluding rows with failed derivation. */
function detectCollisions(rows: readonly TagPrefixPreviewRow[]): TagPrefixCollision[] {
  const pathsByPrefix = new Map<string, string[]>();
  for (const row of rows) {
    if (row.derivedPrefix === null) continue;
    const existing = pathsByPrefix.get(row.derivedPrefix);
    if (existing === undefined) {
      pathsByPrefix.set(row.derivedPrefix, [row.workspacePath]);
    } else {
      existing.push(row.workspacePath);
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

/** Collect the union of successfully-derived prefixes, declared legacy prefixes, and retired prefixes. */
function collectKnownPrefixes(
  rows: readonly TagPrefixPreviewRow[],
  retiredPackages: readonly RetiredPackagePreviewEntry[],
): string[] {
  const known = new Set<string>();
  for (const row of rows) {
    if (row.derivedPrefix !== null) known.add(row.derivedPrefix);
    for (const entry of row.legacyEntries) {
      known.add(entry.prefix);
    }
  }
  for (const retired of retiredPackages) {
    known.add(retired.tagPrefix);
  }
  return [...known];
}

/** Build preview entries for each declared retired package, attaching current tag counts. */
function buildRetiredPreviewEntries(retiredPackages: readonly RetiredPackage[]): RetiredPackagePreviewEntry[] {
  return retiredPackages.map((retired) => ({
    name: retired.name,
    tagPrefix: retired.tagPrefix,
    tagCount: countTagsMatching(retired.tagPrefix),
    ...(retired.successor !== undefined && { successor: retired.successor }),
  }));
}
