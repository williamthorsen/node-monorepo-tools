import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { isRecord } from './typeGuards.ts';
import type { ChangelogEntry, ChangelogItem, ChangelogOverride, ChangelogSection, WorkspaceConfig } from './types.ts';

/** Conventional override-file location relative to a scope root (project, workspace, or single-package). */
const OVERRIDES_FILENAME = '.meta/changelog-overrides.json';

/** Allowed audience values declared in the on-disk override format (full forward-compatible vocabulary). */
const VALID_AUDIENCE_VALUES = new Set(['all', 'dev', 'skip']);

/** Fields v1 supports at runtime. `'all'` and `'dev'` are reserved for v2 reclassification. */
const V1_SUPPORTED_AUDIENCE_VALUES = new Set(['skip']);

/** Known fields on a single override entry; presence of any other field is a validation error. */
const KNOWN_OVERRIDE_FIELDS = new Set(['audience', 'description', 'body', 'breaking']);

/** Result of loading an override file: either parsed overrides or a list of structured errors. */
export type LoadChangelogOverridesResult = { overrides: Map<string, ChangelogOverride> } | { errors: string[] };

/**
 * Load and validate the editorial overrides file at `path`.
 *
 * - Missing file resolves to an empty map (no-op default; matches "absent file → unchanged behavior").
 * - Malformed JSON, wrong top-level shape, or any per-entry validation failure surfaces as
 *   structured errors. Callers decide how to surface them.
 *
 * Returns either `{ overrides: Map }` on success or `{ errors: string[] }` on failure. Pure
 * except for the single file read; performs no other I/O.
 */
export function loadChangelogOverrides(path: string): LoadChangelogOverridesResult {
  if (!existsSync(path)) {
    return { overrides: new Map() };
  }

  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch (error: unknown) {
    return {
      errors: [`Failed to read override file ${path}: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    return {
      errors: [`Failed to parse override file ${path}: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const result = validateChangelogOverrides(parsed);
  if (result.errors.length > 0) {
    return { errors: result.errors };
  }
  return { overrides: result.overrides };
}

/**
 * Validate a parsed override record. Returns the parsed `Map` along with any error messages.
 *
 * Each error names the offending key (e.g. `overrides['abc']: 'audience' must be one of …`)
 * so the consumer can locate it in their override file.
 */
export function validateChangelogOverrides(raw: unknown): {
  overrides: Map<string, ChangelogOverride>;
  errors: string[];
} {
  const overrides = new Map<string, ChangelogOverride>();
  const errors: string[] = [];

  if (!isRecord(raw)) {
    errors.push('Override file: top-level value must be an object keyed by commit hash');
    return { overrides, errors };
  }

  for (const [key, rawEntry] of Object.entries(raw)) {
    if (key === '') {
      errors.push('Override file: empty-string key is not a valid commit hash');
      continue;
    }
    const validated = validateSingleOverride(key, rawEntry, errors);
    if (validated !== undefined) {
      overrides.set(key, validated);
    }
  }

  return { overrides, errors };
}

/**
 * Validate a single override entry for `key`. Returns the parsed `ChangelogOverride` on
 * success, or `undefined` after pushing one or more errors for invalid entries.
 */
function validateSingleOverride(key: string, rawEntry: unknown, errors: string[]): ChangelogOverride | undefined {
  if (!isRecord(rawEntry)) {
    errors.push(`overrides['${key}']: must be an object`);
    return undefined;
  }

  let entryValid = true;
  for (const fieldName of Object.keys(rawEntry)) {
    if (!KNOWN_OVERRIDE_FIELDS.has(fieldName)) {
      errors.push(`overrides['${key}']: unknown field '${fieldName}'`);
      entryValid = false;
    }
  }

  const result: ChangelogOverride = {};
  if (rawEntry.audience !== undefined) {
    const audienceResult = validateAudience(key, rawEntry.audience, errors);
    if (audienceResult === undefined) {
      entryValid = false;
    } else {
      result.audience = audienceResult;
    }
  }

  if (rawEntry.description !== undefined) {
    if (typeof rawEntry.description !== 'string') {
      errors.push(`overrides['${key}']: 'description' must be a string`);
      entryValid = false;
    } else {
      result.description = rawEntry.description;
    }
  }

  if (rawEntry.body !== undefined) {
    if (typeof rawEntry.body !== 'string') {
      errors.push(`overrides['${key}']: 'body' must be a string`);
      entryValid = false;
    } else {
      result.body = rawEntry.body;
    }
  }

  if (rawEntry.breaking !== undefined) {
    if (typeof rawEntry.breaking !== 'boolean') {
      errors.push(`overrides['${key}']: 'breaking' must be a boolean`);
      entryValid = false;
    } else {
      result.breaking = rawEntry.breaking;
    }
  }

  if (Object.keys(result).length === 0 && entryValid) {
    errors.push(`overrides['${key}']: at least one override field must be set`);
    return undefined;
  }

  if (!entryValid) {
    return undefined;
  }
  return result;
}

/**
 * Validate the `audience` field. v1 accepts only `'skip'`; the on-disk format declares the
 * full `'all' | 'dev' | 'skip'` vocabulary so future v2 reclassification needs no schema
 * change. `'all'` and `'dev'` are rejected with an explicit "not yet supported" error.
 *
 * Returns `'skip' | undefined` because v1 narrows to `'skip'` after both guards. v2 will
 * widen this return type to `'all' | 'dev' | 'skip'` once those audiences become supported.
 */
function validateAudience(key: string, value: unknown, errors: string[]): 'skip' | undefined {
  if (typeof value !== 'string' || !VALID_AUDIENCE_VALUES.has(value)) {
    errors.push(`overrides['${key}']: 'audience' must be one of 'all' | 'dev' | 'skip'`);
    return undefined;
  }
  if (!V1_SUPPORTED_AUDIENCE_VALUES.has(value)) {
    errors.push(`overrides['${key}']: audience '${value}' is not yet supported; only 'skip' is currently accepted`);
    return undefined;
  }
  return 'skip';
}

/**
 * Format the standard "stale override key" warning. Callers compute the set of stale keys
 * (keys that didn't match anywhere) and use this helper to surface them uniformly. Centralized
 * so single-package and monorepo flows produce identical warning text.
 */
export function formatStaleOverrideKeyWarning(key: string): string {
  return `Override key '${key}' did not match any commit hash in the changelog (likely a stale reference)`;
}

/**
 * Apply overrides to a `ChangelogEntry[]`, returning a new array. Pure: no mutation, no I/O.
 *
 * Match algorithm: each override key is treated as a string-prefix against `ChangelogItem.hash`.
 * - 0 matches → key is recorded as unmatched in this batch (no warning emitted here).
 * - 1 match → apply each present override field to the matched item, record key as matched.
 * - 2+ matches → error (ambiguous prefix).
 *
 * `matchedKeys` lists the override keys that resolved to exactly one item in this batch.
 * Callers are responsible for computing stale-key warnings: in a monorepo run, an override
 * may target a commit that lives in another workspace, so the per-batch zero-match signal is
 * insufficient on its own. Single-package and monorepo orchestrators format warnings using
 * `formatStaleOverrideKeyWarning` after aggregating `matchedKeys` across all apply calls.
 *
 * v1 audience semantics:
 * - `'skip'` removes the matched item from its containing section. Empty sections are pruned.
 *   Versions with zero sections still appear (matches existing "empty workspace" behavior).
 * - `'all'` and `'dev'` are validated out before reaching the applier.
 *
 * Items without a `hash` (synthetic propagation entries) are never matched and pass through.
 *
 * The function does not throw; warnings/errors accumulate and are returned alongside the
 * transformed entries so the caller decides whether to abort or log-and-continue.
 */
export function applyChangelogOverrides(
  entries: ChangelogEntry[],
  overrides: Map<string, ChangelogOverride>,
): { entries: ChangelogEntry[]; warnings: string[]; errors: string[]; matchedKeys: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  const matchedKeys: string[] = [];

  if (overrides.size === 0) {
    return { entries: entries.map(cloneEntry), warnings, errors, matchedKeys };
  }

  // Pre-compute every hash present in the entry tree so each override key can resolve its
  // matches in one pass over the keyset rather than re-walking the tree per key.
  const allHashes: string[] = [];
  for (const entry of entries) {
    for (const section of entry.sections) {
      for (const item of section.items) {
        if (item.hash !== undefined) {
          allHashes.push(item.hash);
        }
      }
    }
  }

  // Resolve each override key to its set of matching hashes. Zero-match keys are not warned
  // at this layer (caller aggregates across batches); ambiguous prefixes are an error.
  const keyToMatchedHashes = new Map<string, string[]>();
  for (const overrideKey of overrides.keys()) {
    const matches = allHashes.filter((hash) => hash.startsWith(overrideKey));
    if (matches.length === 0) {
      continue;
    }
    if (matches.length > 1) {
      errors.push(
        `Override key '${overrideKey}' is ambiguous: matches multiple commits (${matches.join(', ')}). ` +
          'Use a longer prefix or the full commit hash.',
      );
      continue;
    }
    keyToMatchedHashes.set(overrideKey, matches);
    matchedKeys.push(overrideKey);
  }

  // Build a hash → override lookup so the iteration loop can dispatch overrides per item.
  const hashToOverride = new Map<string, ChangelogOverride>();
  for (const [overrideKey, matchedHashes] of keyToMatchedHashes) {
    const override = overrides.get(overrideKey);
    if (override === undefined) continue;
    for (const hash of matchedHashes) {
      hashToOverride.set(hash, override);
    }
  }

  // Walk the entry → version → section → item tree once, applying overrides and pruning
  // skipped items. This is the dispatch site for current and future per-item override
  // operations; v2 audience reclassification slots in here as a new dispatch branch.
  const transformedEntries: ChangelogEntry[] = [];
  for (const entry of entries) {
    const transformedSections: ChangelogSection[] = [];
    for (const section of entry.sections) {
      const transformedItems = applyOverridesToItems(section.items, hashToOverride);
      if (transformedItems.length === 0) {
        continue;
      }
      transformedSections.push({ ...section, items: transformedItems });
    }
    transformedEntries.push({ ...entry, sections: transformedSections });
  }

  return { entries: transformedEntries, warnings, errors, matchedKeys };
}

/** Apply per-item overrides, dropping items whose `audience` resolves to `'skip'`. */
function applyOverridesToItems(
  items: ChangelogItem[],
  hashToOverride: Map<string, ChangelogOverride>,
): ChangelogItem[] {
  const result: ChangelogItem[] = [];
  for (const item of items) {
    if (item.hash === undefined) {
      result.push(cloneItem(item));
      continue;
    }
    const override = hashToOverride.get(item.hash);
    if (override === undefined) {
      result.push(cloneItem(item));
      continue;
    }
    if (override.audience === 'skip') {
      // Drop the item.
      continue;
    }
    result.push(applyOverrideToItem(item, override));
  }
  return result;
}

/**
 * Apply a single override's per-field replacements to a `ChangelogItem`.
 *
 * Replaces `description`, `body`, and `breaking` when each is present on the override.
 * Leaves the original `hash` intact so future override applications continue to match.
 */
function applyOverrideToItem(item: ChangelogItem, override: ChangelogOverride): ChangelogItem {
  const result: ChangelogItem = { ...item };
  if (override.description !== undefined) {
    result.description = override.description;
  }
  if (override.body !== undefined) {
    result.body = override.body;
  }
  if (override.breaking !== undefined) {
    result.breaking = override.breaking;
  }
  return result;
}

/** Shallow-clone a `ChangelogItem` so callers receive a fresh array of items. */
function cloneItem(item: ChangelogItem): ChangelogItem {
  return { ...item };
}

/** Shallow-clone a `ChangelogEntry` and its sections so the no-op path returns a fresh array. */
function cloneEntry(entry: ChangelogEntry): ChangelogEntry {
  return {
    ...entry,
    sections: entry.sections.map((section) => ({ ...section, items: section.items.map(cloneItem) })),
  };
}

/**
 * Resolve the conventional override-file path for a given scope root.
 *
 * `scopeRoot` is the directory at which a scope's other artifacts live (e.g., `'.'` for the
 * project, `'packages/foo'` for a workspace). The returned path is repo-relative.
 */
export function resolveOverridePath(scopeRoot: string): string {
  return path.posix.join(scopeRoot, OVERRIDES_FILENAME);
}

/** Result of {@link loadOverridesForScopes}: per-scope maps plus accumulated load/validation errors. */
export interface LoadOverridesForScopesResult {
  /** Project-tier (root) overrides. Empty map when the project file is absent. */
  project: Map<string, ChangelogOverride>;
  /** Workspace-tier overrides keyed by `workspacePath` (e.g., `'packages/foo'`). Empty map when absent. */
  perWorkspace: Map<string, Map<string, ChangelogOverride>>;
  /** All load and validation errors across every requested scope, prefixed with the offending file path. */
  errors: string[];
}

/**
 * Load and validate every requested override file in one pass.
 *
 * Iterates the configured scope roots, calls {@link loadChangelogOverrides} for each, and
 * aggregates errors across all files (rather than throwing on the first failure) so a
 * consumer who edits multiple files at once sees every problem in one report. Missing files
 * resolve to empty maps — matches the existing single-file behavior.
 *
 * The caller is expected to surface a combined error when `errors.length > 0` and abort the
 * release before any workspace begins writing.
 */
export function loadOverridesForScopes(scopes: {
  project?: string;
  workspaces?: string[];
}): LoadOverridesForScopesResult {
  const errors: string[] = [];
  let project = new Map<string, ChangelogOverride>();
  const perWorkspace = new Map<string, Map<string, ChangelogOverride>>();

  if (scopes.project !== undefined) {
    const result = loadChangelogOverrides(resolveOverridePath(scopes.project));
    if ('errors' in result) {
      errors.push(...result.errors);
    } else {
      project = result.overrides;
    }
  }

  for (const workspacePath of scopes.workspaces ?? []) {
    const result = loadChangelogOverrides(resolveOverridePath(workspacePath));
    if ('errors' in result) {
      errors.push(...result.errors);
    } else if (result.overrides.size > 0) {
      perWorkspace.set(workspacePath, result.overrides);
    }
  }

  return { project, perWorkspace, errors };
}

/**
 * Compose root and workspace override maps into a single effective map for one workspace.
 *
 * Byte-equal-key shadowing: when a workspace key string-equals a root key, the workspace
 * entry wins entirely (no field-level merge) and supplants the root entry in the result.
 * Different-prefix keys that happen to resolve to the same commit do NOT shadow here — they
 * fall through to the existing ambiguous-prefix error in {@link applyChangelogOverrides}.
 *
 * Pure: never mutates inputs.
 */
export function composeOverrides(
  rootEntries: Map<string, ChangelogOverride>,
  workspaceEntries: Map<string, ChangelogOverride> | undefined,
): Map<string, ChangelogOverride> {
  const composed = new Map<string, ChangelogOverride>(rootEntries);
  if (workspaceEntries !== undefined) {
    for (const [key, value] of workspaceEntries) {
      composed.set(key, value);
    }
  }
  return composed;
}

/**
 * Shared override-application context threaded through the per-workspace and project apply
 * sites. Bundles the loaded per-scope maps with the run-scoped warning aggregators so each
 * call site can both consume the maps it needs and report into the same warning channel.
 *
 * `globalMatchedRootKeys` tracks ROOT keys matched in any apply call. Workspace-sourced
 * matched keys are not added here — they're tracked locally per workspace because their
 * stale-key semantics are local (a workspace key that doesn't match in its own workspace is
 * unambiguously stale and is warned immediately, not aggregated to end-of-run).
 */
export interface OverrideContext {
  project: Map<string, ChangelogOverride>;
  perWorkspace: Map<string, Map<string, ChangelogOverride>>;
  overrideWarnings: string[];
  globalMatchedRootKeys: Set<string>;
}

/**
 * Load all per-scope override files (root + every workspace) in one upfront pass, validate
 * them, and bundle the results with run-scoped warning aggregators. Aborts the release with
 * a clear error when any file is malformed — checked-in editorial config that does not parse
 * is a bug, and we want the prepare run to fail before any workspace begins writing.
 */
export function createOverrideContext(workspaces: WorkspaceConfig[]): OverrideContext {
  const result = loadOverridesForScopes({
    project: '.',
    workspaces: workspaces.map((workspace) => workspace.workspacePath),
  });
  if (result.errors.length > 0) {
    throw new Error(`Failed to load changelog overrides:\n  - ${result.errors.join('\n  - ')}`);
  }
  return {
    project: result.project,
    perWorkspace: result.perWorkspace,
    overrideWarnings: [],
    globalMatchedRootKeys: new Set<string>(),
  };
}

/** Per-scope input to {@link validateAllChangelogOverrides}. */
export interface ChangelogOverrideScope {
  /** Path to the override file (relative to the repo root). Used to load the file and to attribute findings. */
  filePath: string;
  /** Commit hashes in this scope's history window. Each override key is matched against these. */
  hashes: readonly string[];
}

/** Inputs to {@link validateAllChangelogOverrides}. */
export interface ValidateAllChangelogOverridesInputs {
  /**
   * Project-tier scope (the override file at the repo root).
   *
   * The file at `filePath` is loaded once and used in two ways:
   * - Its overrides are composed into every workspace's apply (root-tier overrides apply globally).
   * - When `hashes` is provided, the project map is also applied directly to that hash universe
   *   (project release in monorepo mode, or the package's history in single-package mode).
   *
   * Omit when no project file exists (rare — most repos have a root file even if empty).
   */
  project?: { filePath: string; hashes?: readonly string[] };
  /** Per-workspace scopes. Each workspace's file applies only to its own hash universe. */
  workspaces?: readonly ChangelogOverrideScope[];
}

/** Result of {@link validateAllChangelogOverrides}: aggregated errors and warnings, each prefixed with the file path it pertains to. */
export interface ValidateAllChangelogOverridesResult {
  errors: string[];
  warnings: string[];
}

/**
 * End-to-end health check across every override file and scope. Pure: takes already-collected
 * hash universes and returns aggregated findings. The CLI command and any other consumer
 * (programmatic library callers, future composite checks) wrap this with discovery and I/O.
 *
 * The match-set is byte-equal to what `release-kit prepare` would compute, including the
 * tier asymmetry: workspace-tier keys are stale if they don't match in their own workspace;
 * root-tier keys are stale only if they don't match in any scope (no workspace AND not the
 * project release window).
 *
 * Every returned string is prefixed with the relative override-file path it pertains to so
 * consumers can locate the offending file without further structuring.
 */
export function validateAllChangelogOverrides(
  inputs: ValidateAllChangelogOverridesInputs,
): ValidateAllChangelogOverridesResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const projectFilePath = inputs.project?.filePath;
  const projectMap = loadScopeMap(projectFilePath, errors);

  const workspaceMaps = (inputs.workspaces ?? []).map((scope) => ({
    filePath: scope.filePath,
    hashes: scope.hashes,
    map: loadScopeMap(scope.filePath, errors),
  }));

  // Track root keys matched anywhere — in any non-shadowing workspace OR in the project
  // release. Shadowed matches do NOT count, mirroring `applyWorkspaceOverrides`'s semantics:
  // a root key that's overridden everywhere is functionally dead and reported as stale.
  const globalMatchedRootKeys = new Set<string>();

  for (const workspace of workspaceMaps) {
    processWorkspaceScope({
      workspace,
      projectFilePath,
      projectMap,
      errors,
      warnings,
      globalMatchedRootKeys,
    });
  }

  const projectHashes = inputs.project?.hashes;
  if (projectFilePath !== undefined && projectHashes !== undefined) {
    processProjectScope({ projectFilePath, projectMap, projectHashes, errors, globalMatchedRootKeys });
  }

  // Root-tier stale keys: project keys matched nowhere (after honoring shadowing).
  if (projectFilePath !== undefined) {
    collectRootStaleWarnings(projectFilePath, projectMap, globalMatchedRootKeys, warnings);
  }

  return { errors, warnings };
}

interface WorkspaceScopeArgs {
  workspace: { filePath: string; hashes: readonly string[]; map: Map<string, ChangelogOverride> };
  projectFilePath: string | undefined;
  projectMap: Map<string, ChangelogOverride>;
  errors: string[];
  warnings: string[];
  globalMatchedRootKeys: Set<string>;
}

/**
 * Process one workspace scope: surface ambiguous-prefix errors (attributing each to its source
 * file), record workspace-tier stale warnings, and contribute non-shadowed root-key matches
 * to `globalMatchedRootKeys`.
 *
 * Apply is split into two calls (workspace map alone; project map minus shadowed keys) so
 * errors attribute to the file that contains the offending key, not to the composed view.
 * Stale detection runs independently from prefix-match counts so ambiguous keys (2+ hits)
 * aren't doubly flagged as stale.
 */
function processWorkspaceScope(args: WorkspaceScopeArgs): void {
  const { workspace, projectFilePath, projectMap, errors, warnings, globalMatchedRootKeys } = args;
  const { filePath, hashes, map } = workspace;

  const workspaceApplied = applyChangelogOverrides(makeValidationEntries(hashes), map);
  for (const message of workspaceApplied.errors) {
    errors.push(prefixWithFilePath(filePath, message));
  }

  if (projectFilePath !== undefined && projectMap.size > 0) {
    const projectMinusShadowed = filterShadowedKeys(projectMap, map);
    const projectApplied = applyChangelogOverrides(makeValidationEntries(hashes), projectMinusShadowed);
    for (const message of projectApplied.errors) {
      errors.push(prefixWithFilePath(projectFilePath, message));
    }
  }

  for (const key of map.keys()) {
    if (!hasAnyMatch(key, hashes)) {
      warnings.push(formatWorkspaceStaleWarning(filePath, key));
    }
  }

  for (const key of projectMap.keys()) {
    // Workspace-shadowed root keys do not count as root matches.
    if (map.has(key)) continue;
    if (hasAnyMatch(key, hashes)) {
      globalMatchedRootKeys.add(key);
    }
  }
}

interface ProjectScopeArgs {
  projectFilePath: string;
  projectMap: Map<string, ChangelogOverride>;
  projectHashes: readonly string[];
  errors: string[];
  globalMatchedRootKeys: Set<string>;
}

/**
 * Process the project release scope: surface ambiguous-prefix errors and contribute every
 * matched root key to `globalMatchedRootKeys`. Only invoked when the caller supplied a
 * project release window (monorepo with a `project` block, or single-package mode).
 */
function processProjectScope(args: ProjectScopeArgs): void {
  const { projectFilePath, projectMap, projectHashes, errors, globalMatchedRootKeys } = args;
  const applied = applyChangelogOverrides(makeValidationEntries(projectHashes), projectMap);
  for (const message of applied.errors) {
    errors.push(prefixWithFilePath(projectFilePath, message));
  }
  for (const key of projectMap.keys()) {
    if (hasAnyMatch(key, projectHashes)) {
      globalMatchedRootKeys.add(key);
    }
  }
}

/** Push a root-stale warning for every project key not already marked as matched. */
function collectRootStaleWarnings(
  projectFilePath: string,
  projectMap: Map<string, ChangelogOverride>,
  globalMatchedRootKeys: Set<string>,
  warnings: string[],
): void {
  for (const key of projectMap.keys()) {
    if (!globalMatchedRootKeys.has(key)) {
      warnings.push(formatRootStaleWarning(projectFilePath, key));
    }
  }
}

function hasAnyMatch(key: string, hashes: readonly string[]): boolean {
  return hashes.some((hash) => hash.startsWith(key));
}

/** Return a fresh map containing every entry of `projectMap` whose key does not appear in `workspaceMap`. */
function filterShadowedKeys(
  projectMap: Map<string, ChangelogOverride>,
  workspaceMap: Map<string, ChangelogOverride>,
): Map<string, ChangelogOverride> {
  const result = new Map<string, ChangelogOverride>();
  for (const [key, value] of projectMap) {
    if (workspaceMap.has(key)) continue;
    result.set(key, value);
  }
  return result;
}

/** Load a scope's override map, pushing any load/schema errors (each prefixed with the file path) onto `errors`. */
function loadScopeMap(filePath: string | undefined, errors: string[]): Map<string, ChangelogOverride> {
  if (filePath === undefined) {
    return new Map();
  }
  const result = loadChangelogOverrides(filePath);
  if ('errors' in result) {
    for (const message of result.errors) {
      errors.push(prefixWithFilePath(filePath, message));
    }
    return new Map();
  }
  return result.overrides;
}

/** Build a single synthetic `ChangelogEntry[]` whose items carry the given hashes — sufficient for `applyChangelogOverrides`'s matching logic. */
function makeValidationEntries(hashes: readonly string[]): ChangelogEntry[] {
  return [
    {
      version: '0.0.0',
      date: '0000-00-00',
      sections: [
        {
          title: 'Validation',
          audience: 'all',
          items: hashes.map((hash) => ({ description: '', hash })),
        },
      ],
    },
  ];
}

function prefixWithFilePath(filePath: string, message: string): string {
  return `${filePath}: ${message}`;
}

function formatWorkspaceStaleWarning(filePath: string, key: string): string {
  return `${filePath}: Override key '${key}' did not match any commit in this workspace's history (likely a stale reference)`;
}

function formatRootStaleWarning(filePath: string, key: string): string {
  return `${filePath}: Override key '${key}' did not match any commit in any scope (likely a stale reference)`;
}

/**
 * Apply the composed (root + workspace) override map to a workspace's changelog entries and
 * report stale-key warnings tier-by-tier.
 *
 * The composed map is applied in a single {@link applyChangelogOverrides} call. Matched keys
 * are demultiplexed by source via `Map.has` lookups on the original (uncomposed) maps so the
 * stale-key semantics stay tier-aware:
 *
 * - Workspace-sourced keys (those present in the per-workspace map, regardless of whether
 *   the root map also has the same byte-equal key) that did NOT match are unambiguously
 *   stale in their own apply context — push an immediate stale warning naming the key.
 * - Root-sourced matched keys (present in root, absent from this workspace's map) are added
 *   to `globalMatchedRootKeys` so the orchestrator's end-of-run loop can dedupe across
 *   batches and warn only on root keys that matched nowhere.
 *
 * Throws when any apply call surfaces an error (e.g. ambiguous prefix). Returns the applied
 * result so the caller can consume `applied.entries` for downstream rendering.
 */
export function applyWorkspaceOverrides(
  newEntries: ChangelogEntry[],
  workspacePath: string,
  overrideContext: OverrideContext,
): ReturnType<typeof applyChangelogOverrides> {
  const { project, perWorkspace, overrideWarnings, globalMatchedRootKeys } = overrideContext;
  const workspaceOverrides = perWorkspace.get(workspacePath);
  const composed = composeOverrides(project, workspaceOverrides);
  const applied = applyChangelogOverrides(newEntries, composed);
  if (applied.errors.length > 0) {
    throw new Error(`Changelog override application failed:\n  - ${applied.errors.join('\n  - ')}`);
  }
  overrideWarnings.push(...applied.warnings);

  const matchedSet = new Set(applied.matchedKeys);
  // Workspace tier: every workspace key not in the matched set is stale here and now.
  if (workspaceOverrides !== undefined) {
    for (const key of workspaceOverrides.keys()) {
      if (!matchedSet.has(key)) {
        overrideWarnings.push(formatStaleOverrideKeyWarning(key));
      }
    }
  }
  // Root tier: only matched keys that came from root (i.e., not shadowed by a byte-equal
  // workspace key) contribute to the global aggregator. Membership in `project` is an
  // invariant — `applied.matchedKeys` is a subset of `composed.keys() = project ∪ workspace`,
  // so once the workspace-shadow check skips out, every remaining key is in `project`.
  for (const key of applied.matchedKeys) {
    if (workspaceOverrides?.has(key)) continue;
    globalMatchedRootKeys.add(key);
  }
  return applied;
}
