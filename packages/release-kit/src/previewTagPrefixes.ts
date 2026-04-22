import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

import { deriveWorkspaceConfig } from './deriveWorkspaceConfig.ts';
import type { UndeclaredTagPrefix } from './detectUndeclaredTagPrefixes.ts';
import { detectUndeclaredTagPrefixes } from './detectUndeclaredTagPrefixes.ts';
import { discoverWorkspaces } from './discoverWorkspaces.ts';
import { loadConfig } from './loadConfig.ts';
import type { LegacyIdentity, ReleaseKitConfig, RetiredPackage } from './types.ts';
import { validateConfig } from './validateConfig.ts';

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
 * Discovers workspaces via `discoverWorkspaces()`, derives each workspace's tag prefix
 * via `deriveWorkspaceConfig()`, and records the derivation error on failure rather than aborting.
 * Loads `.config/release-kit.config.ts` to surface declared legacy prefixes per workspace,
 * scans local git tags for undeclared candidate prefixes via `detectUndeclaredTagPrefixes`,
 * and reports collisions across successfully-derived prefixes.
 */
export async function previewTagPrefixes(): Promise<TagPrefixPreview> {
  const workspacePaths = (await discoverWorkspaces()) ?? [];
  const userConfig = await loadUserConfig();
  const overridesByDir = buildOverrideMap(userConfig);

  const workspaces: TagPrefixPreviewRow[] = [];
  for (const workspacePath of workspacePaths) {
    workspaces.push(buildPreviewRow(workspacePath, overridesByDir));
  }

  const retiredPackages = buildRetiredPreviewEntries(userConfig?.retiredPackages ?? []);

  const collisions = detectCollisions(workspaces);
  const knownPrefixes = collectKnownPrefixes(workspaces, retiredPackages);
  const undeclaredCandidates = detectUndeclaredTagPrefixes(knownPrefixes);

  return { workspaces, collisions, undeclaredCandidates, retiredPackages };
}

/** Load and validate `.config/release-kit.config.ts`, returning undefined on absent/invalid. */
async function loadUserConfig(): Promise<ReleaseKitConfig | undefined> {
  let raw: unknown;
  try {
    raw = await loadConfig();
  } catch {
    return undefined;
  }
  if (raw === undefined) return undefined;
  const { config, errors } = validateConfig(raw);
  return errors.length === 0 ? config : undefined;
}

/** Build a `dir -> legacyIdentities` lookup map from a validated config. */
function buildOverrideMap(userConfig: ReleaseKitConfig | undefined): Map<string, LegacyIdentity[]> {
  const map = new Map<string, LegacyIdentity[]>();
  if (userConfig?.workspaces === undefined) return map;
  for (const entry of userConfig.workspaces) {
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
    derivationError = error instanceof Error ? error.message : String(error);
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
    ...(retired.successor !== undefined ? { successor: retired.successor } : {}),
  }));
}
