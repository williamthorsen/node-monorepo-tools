import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describeError } from '@williamthorsen/toolbelt.errors';

import { extractMigration } from './extractMigration.ts';
import { isRecord } from './typeGuards.ts';
import type { ChangelogEntry, ChangelogItem, ChangelogOverride, ChangelogSection, WorkspaceConfig } from './types.ts';

/** Conventional override-file location relative to a scope root (project, workspace, or single-package). */
const OVERRIDES_FILENAME = '.meta/changelog-overrides.json';

/** Allowed audience values declared in the on-disk override format (full forward-compatible vocabulary). */
const VALID_AUDIENCE_VALUES = new Set(['all', 'dev', 'skip']);

/** The audience values that the applier supports; the format reserves `'all'` and `'dev'` for reclassification. */
const V1_SUPPORTED_AUDIENCE_VALUES = new Set(['skip']);

/** Known fields on a single override entry; presence of any other field is a validation error. */
export const KNOWN_OVERRIDE_FIELDS = new Set(['audience', 'description', 'body', 'breaking']);

/** Form of an override key: a lowercase hex commit hash or prefix, optionally followed by `:<n>`, a 1-based entry position. */
export const OVERRIDE_KEY_PATTERN = /^[0-9a-f]+(:[1-9][0-9]*)?$/;

/** Top-level key that names the file's JSON Schema for editor support; not an override. */
const SCHEMA_KEY = '$schema';

/** Result of loading an override file: either parsed overrides or a list of structured errors. */
export type LoadChangelogOverridesResult = { overrides: Map<string, ChangelogOverride> } | { errors: string[] };

/**
 * Loads and validates the editorial overrides file at `path`. A missing file yields an empty map; an unreadable file,
 * malformed JSON, a wrong top-level shape, or any per-entry validation failure yields errors.
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
      errors: [`Failed to read override file ${path}: ${describeError(error)}`],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    return {
      errors: [`Failed to parse override file ${path}: ${describeError(error)}`],
    };
  }

  const result = validateChangelogOverrides(parsed);
  if (result.errors.length > 0) {
    return { errors: result.errors };
  }
  return { overrides: result.overrides };
}

/**
 * Validates a parsed override record, returning the valid overrides and an error message for each problem.
 *
 * Each error names the offending key (e.g. `overrides['abc']: 'audience' must be one of …`) so that the user can find
 * it in the override file.
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
    if (key === SCHEMA_KEY) {
      if (typeof rawEntry !== 'string') {
        errors.push(`Override file: '${SCHEMA_KEY}' must be a string`);
      }
      continue;
    }
    if (!OVERRIDE_KEY_PATTERN.test(key)) {
      errors.push(
        `overrides['${key}']: key must be a lowercase hex commit hash or prefix, optionally followed by ':<n>'`,
      );
      continue;
    }
    const validated = validateSingleOverride(key, rawEntry, errors);
    if (validated !== undefined) {
      overrides.set(key, validated);
    }
  }

  return { overrides, errors };
}

/** Splits a valid override key into its hash prefix and, for an ordinal key, its 1-based entry position. */
export function parseOverrideKey(key: string): { hashPrefix: string; entry?: number } {
  const separatorIndex = key.indexOf(':');
  if (separatorIndex === -1) {
    return { hashPrefix: key };
  }
  return { hashPrefix: key.slice(0, separatorIndex), entry: Number(key.slice(separatorIndex + 1)) };
}

/** Validates the override entry for `key`, returning it, or undefined after pushing one or more errors. */
function validateSingleOverride(key: string, rawEntry: unknown, errors: string[]): ChangelogOverride | undefined {
  if (!isRecord(rawEntry)) {
    errors.push(`overrides['${key}']: must be an object`);
    return undefined;
  }

  let entryValid = true;
  for (const fieldName of Object.keys(rawEntry)) {
    if (KNOWN_OVERRIDE_FIELDS.has(fieldName)) {
      continue;
    }

    errors.push(`overrides['${key}']: unknown field '${fieldName}'`);
    entryValid = false;
  }

  const result: ChangelogOverride = {};
  if (rawEntry['audience'] !== undefined) {
    const audienceResult = validateAudience(key, rawEntry['audience'], errors);
    if (audienceResult === undefined) {
      entryValid = false;
    } else {
      result.audience = audienceResult;
    }
  }

  if (rawEntry['description'] !== undefined) {
    if (typeof rawEntry['description'] !== 'string') {
      errors.push(`overrides['${key}']: 'description' must be a string`);
      entryValid = false;
    } else {
      result.description = rawEntry['description'];
    }
  }

  if (rawEntry['body'] !== undefined) {
    if (typeof rawEntry['body'] !== 'string') {
      errors.push(`overrides['${key}']: 'body' must be a string`);
      entryValid = false;
    } else {
      result.body = rawEntry['body'];
    }
  }

  if (rawEntry['breaking'] !== undefined) {
    if (typeof rawEntry['breaking'] !== 'boolean') {
      errors.push(`overrides['${key}']: 'breaking' must be a boolean`);
      entryValid = false;
    } else {
      result.breaking = rawEntry['breaking'];
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
 * Validates the `audience` field. The format declares `'all' | 'dev' | 'skip'` so that reclassification needs no
 * schema change, but only `'skip'` is supported; `'all'` and `'dev'` are rejected as not yet supported.
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

/** Formats the warning for an override key that matched no item in the changelog. */
export function formatStaleOverrideKeyWarning(key: string): string {
  return `Override key '${key}' did not match any item in the changelog (likely a stale reference)`;
}

/**
 * Applies overrides to changelog entries, returning new entries without mutating the input.
 *
 * Each key's hash prefix is matched against the distinct `ChangelogItem.hash` values:
 * - No match: the key is unmatched in this batch, and no warning is emitted here.
 * - One match: a bare key resolves to every item of that commit, and an ordinal key `<hash>:<n>` to the items whose
 *   `entry` is `n`. A key that resolves to no item is unmatched, so an ordinal key on a title-derived item goes stale.
 * - Several matches: an error (ambiguous prefix).
 *
 * Two more conditions are errors, and the keys involved apply nowhere: a bare key that sets `description` or `body` on a
 * commit with several items, and two keys that resolve to the same item.
 *
 * `matchedKeys` lists the keys that resolved to at least one item without error. The caller computes stale-key
 * warnings, because in a monorepo a key may target a commit in another workspace: A key unmatched in one batch is not
 * necessarily stale.
 *
 * An override whose audience is `'skip'` removes its item, and a section left empty is dropped; an entry left with no
 * sections is kept. An item without a `hash`, such as a synthetic propagation item, passes through unmatched. Errors
 * are returned rather than thrown, and the caller decides whether to abort.
 */
export function applyChangelogOverrides(
  entries: ChangelogEntry[],
  overrides: Map<string, ChangelogOverride>,
): { entries: ChangelogEntry[]; warnings: string[]; errors: string[]; matchedKeys: string[] } {
  const warnings: string[] = [];

  if (overrides.size === 0) {
    return { entries: entries.map(cloneEntry), warnings, errors: [], matchedKeys: [] };
  }

  const { errors, itemIdToKey } = resolveOverrideKeys(indexEntryPositions(entries), overrides);

  const itemIdToOverride = new Map<string, ChangelogOverride>();
  for (const [itemId, overrideKey] of itemIdToKey) {
    const override = overrides.get(overrideKey);
    if (override !== undefined) {
      itemIdToOverride.set(itemId, override);
    }
  }
  const matchedKeys = [...new Set(itemIdToKey.values())];

  const transformedEntries: ChangelogEntry[] = [];
  for (const entry of entries) {
    const transformedSections: ChangelogSection[] = [];
    for (const section of entry.sections) {
      const transformedItems = applyOverridesToItems(section.items, itemIdToOverride);
      if (transformedItems.length === 0) {
        continue;
      }
      transformedSections.push({ ...section, items: transformedItems });
    }
    transformedEntries.push({ ...entry, sections: transformedSections });
  }

  return { entries: transformedEntries, warnings, errors, matchedKeys };
}

/**
 * Resolves every override key to the items that it targets, and reports ambiguous prefixes, field overrides on a bare
 * key that spans several items, and keys that overlap on an item. Returns the item-to-key map with every erroring key
 * removed.
 */
function resolveOverrideKeys(
  positionsByHash: Map<string, Set<number | undefined>>,
  overrides: Map<string, ChangelogOverride>,
): { errors: string[]; itemIdToKey: Map<string, string> } {
  const errors: string[] = [];
  const failedKeys = new Set<string>();
  const itemIdToKey = new Map<string, string>();

  for (const [overrideKey, override] of overrides) {
    const resolution = resolveOverrideKey(overrideKey, positionsByHash);
    if (resolution.kind === 'ambiguous') {
      errors.push(
        `Override key '${overrideKey}' is ambiguous: matches multiple commits (${resolution.hashes.join(', ')}). ` +
          'Use a longer prefix or the full commit hash.',
      );
      continue;
    }
    if (resolution.kind === 'none') {
      continue;
    }

    const { hash, positions } = resolution;
    if (parseOverrideKey(overrideKey).entry === undefined && positions.length > 1) {
      const fieldsSet = (['description', 'body'] as const).filter((field) => override[field] !== undefined);
      if (fieldsSet.length > 0) {
        const ordinalKeys = positions.map((position) => `${overrideKey}:${position}`).join(', ');
        errors.push(
          `Override key '${overrideKey}' sets ${fieldsSet.join(' and ')} on a commit with several items; use ${ordinalKeys}`,
        );
        continue;
      }
    }

    for (const position of positions) {
      const itemId = formatItemId(hash, position);
      const claimingKey = itemIdToKey.get(itemId);
      if (claimingKey === undefined) {
        itemIdToKey.set(itemId, overrideKey);
        continue;
      }
      const target = position === undefined ? `commit ${hash}` : `the item at ${hash}:${position}`;
      errors.push(`Override keys '${claimingKey}' and '${overrideKey}' both match ${target}; keep one`);
      failedKeys.add(claimingKey);
      failedKeys.add(overrideKey);
    }
  }

  for (const [itemId, overrideKey] of itemIdToKey) {
    if (failedKeys.has(overrideKey)) {
      itemIdToKey.delete(itemId);
    }
  }
  return { errors, itemIdToKey };
}

/**
 * Resolves one override key against the commits' entry positions. `positions` lists the targeted items' `entry` values,
 * ascending, with `undefined` standing for a title-derived item; it is empty when the commit has no item that the key
 * targets.
 */
function resolveOverrideKey(
  overrideKey: string,
  positionsByHash: Map<string, Set<number | undefined>>,
):
  | { kind: 'none' }
  | { kind: 'ambiguous'; hashes: string[] }
  | { kind: 'items'; hash: string; positions: (number | undefined)[] } {
  const { hashPrefix, entry } = parseOverrideKey(overrideKey);
  const hashes = positionsByHash
    .keys()
    .filter((hash) => hash.startsWith(hashPrefix))
    .toArray();
  const [hash] = hashes;
  if (hash === undefined) {
    return { kind: 'none' };
  }
  if (hashes.length > 1) {
    return { kind: 'ambiguous', hashes };
  }

  const available = [...(positionsByHash.get(hash) ?? [])];
  const positions =
    entry === undefined
      ? available.toSorted((left, right) => (left ?? 0) - (right ?? 0))
      : available.filter((position) => position === entry);
  return positions.length === 0 ? { kind: 'none' } : { kind: 'items', hash, positions };
}

/** Collects, for each commit hash in the entry tree, the distinct `entry` positions of its items. */
function indexEntryPositions(entries: readonly ChangelogEntry[]): Map<string, Set<number | undefined>> {
  return indexItemPositions(entries.flatMap((entry) => entry.sections.flatMap((section) => section.items)));
}

/** Collects, for each hash, the distinct `entry` positions of the items that carry it. */
function indexItemPositions(
  items: readonly { hash?: string | undefined; entry?: number | undefined }[],
): Map<string, Set<number | undefined>> {
  const positionsByHash = new Map<string, Set<number | undefined>>();
  for (const item of items) {
    if (item.hash === undefined) continue;
    const positions = positionsByHash.get(item.hash) ?? new Set<number | undefined>();
    positions.add(item.entry);
    positionsByHash.set(item.hash, positions);
  }
  return positionsByHash;
}

/** Formats the ID of an item from its commit hash and entry position. */
function formatItemId(hash: string, entry: number | undefined): string {
  return entry === undefined ? hash : `${hash}:${entry}`;
}

/** Applies per-item overrides, dropping items whose `audience` resolves to `'skip'`. */
function applyOverridesToItems(
  items: ChangelogItem[],
  itemIdToOverride: Map<string, ChangelogOverride>,
): ChangelogItem[] {
  const result: ChangelogItem[] = [];
  for (const item of items) {
    if (item.hash === undefined) {
      result.push(cloneItem(item));
      continue;
    }
    const override = itemIdToOverride.get(formatItemId(item.hash, item.entry));
    if (override === undefined) {
      result.push(cloneItem(item));
      continue;
    }
    if (override.audience === 'skip') {
      continue;
    }
    result.push(applyOverrideToItem(item, override));
  }
  return result;
}

/**
 * Applies one override's field replacements to a `ChangelogItem`.
 *
 * A title-derived item re-derives `migration` from a replacement body so that the two cannot disagree; an item derived
 * from a change-record entry keeps the entry's `migration`, which no body contains. An override file cannot set
 * `migration`. The item keeps its `hash`, so that a later application still matches it.
 */
function applyOverrideToItem(item: ChangelogItem, override: ChangelogOverride): ChangelogItem {
  const result: ChangelogItem = { ...item };
  if (override.description !== undefined) {
    result.description = override.description;
  }
  if (override.body !== undefined) {
    result.body = override.body;
  }
  if (override.body !== undefined && item.entry === undefined) {
    const migration = extractMigration(override.body);
    if (migration === undefined) {
      // The spread carried a migration extracted from the superseded body.
      delete result.migration;
    } else {
      result.migration = migration;
    }
  }
  if (override.breaking !== undefined) {
    result.breaking = override.breaking;
  }
  return result;
}

/** Shallow-clones a `ChangelogItem`, so that the result shares no item object with the input. */
function cloneItem(item: ChangelogItem): ChangelogItem {
  return { ...item };
}

/** Shallow-clones a `ChangelogEntry` down to its items, so that the result shares no object with the input. */
function cloneEntry(entry: ChangelogEntry): ChangelogEntry {
  return {
    ...entry,
    sections: entry.sections.map((section) => ({ ...section, items: section.items.map(cloneItem) })),
  };
}

/**
 * Resolves the conventional override-file path for a scope root: the directory in which a scope's other artifacts live
 * (e.g., `'.'` for the project, `'packages/foo'` for a workspace). The returned path is repo-relative.
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
 * Loads and validates the override file of every requested scope, collecting the errors of all files rather than
 * stopping at the first, so that a user who edits several files sees every problem in one report. A missing file
 * yields an empty map.
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

  const workspacePaths = scopes.workspaces ?? [];
  for (const workspacePath of workspacePaths) {
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
 * Composes root and workspace override maps into the effective map for one workspace, without mutating either.
 *
 * A workspace key identical to a root key replaces the root entry entirely, with no field-level merge. Distinct keys
 * that resolve to the same item do not shadow each other here: {@link applyChangelogOverrides} reports them as
 * overlapping.
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
 * The loaded per-scope override maps and the run's warning aggregators, shared by every apply of a prepare run.
 *
 * `globalMatchedRootKeys` holds the root keys matched in any apply. Workspace keys are not added: A workspace key that
 * matches nothing in its own workspace is stale, and it is warned about at once rather than at the end of the run.
 */
export interface OverrideContext {
  project: Map<string, ChangelogOverride>;
  perWorkspace: Map<string, Map<string, ChangelogOverride>>;
  overrideWarnings: string[];
  globalMatchedRootKeys: Set<string>;
}

/**
 * Loads and validates the override files of the root and every workspace, and bundles them with empty warning
 * aggregators. Throws if any file fails to load, so that a malformed checked-in override file stops `prepare` before
 * any workspace writes.
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

/** A changelog item as override matching sees it. `entry` is absent for a title-derived item. */
export interface OverrideTargetItem {
  hash: string;
  entry?: number;
}

/** Per-scope input to {@link validateAllChangelogOverrides}. */
export interface ChangelogOverrideScope {
  /**
   * Path to the override file, used to load the file and to attribute findings. A relative path resolves against the
   * process working directory.
   */
  filePath: string;
  /** Items in this scope's history window. Each override key is matched against these. */
  items: readonly OverrideTargetItem[];
}

/** Inputs to {@link validateAllChangelogOverrides}. */
export interface ValidateAllChangelogOverridesInputs {
  /**
   * Project-tier scope (the override file at the repo root).
   *
   * The file at `filePath` is loaded once and used in two ways:
   * - Its overrides are composed into every workspace's apply (root-tier overrides apply globally).
   * - When `items` is provided, the project map is also applied directly to those items
   *   (project release in monorepo mode, or the package's history in single-package mode).
   *
   * Omit when no project file exists.
   */
  project?: { filePath: string; items?: readonly OverrideTargetItem[] };
  /** Per-workspace scopes. Each workspace's file applies only to its own items. */
  workspaces?: readonly ChangelogOverrideScope[];
}

/**
 * Result of {@link validateAllChangelogOverrides}: aggregated errors and warnings, each prefixed with the path of the
 * file to which it pertains.
 */
export interface ValidateAllChangelogOverridesResult {
  errors: string[];
  warnings: string[];
}

/**
 * Validates every override file against the items of its scopes and returns the aggregated findings. It reads the
 * override files but collects no items: The caller supplies each scope's items.
 *
 * Items built by `buildChangelogEntries`, as `release-kit prepare` builds them, yield the matches that `prepare`
 * computes, tier asymmetry included: A workspace-tier key is stale when it matches nothing in its own workspace, and a
 * root-tier key only when it matches nothing in any scope, the project release window included.
 *
 * Every returned string is prefixed with the path of the override file to which it pertains.
 *
 * A relative `filePath`, in any scope, resolves against the process working directory, not against the repo root.
 * A caller running from elsewhere passes absolute paths or changes directory first.
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
    items: scope.items,
    map: loadScopeMap(scope.filePath, errors),
  }));

  // Collect the root keys matched in the project release or in a workspace that does not shadow them; a root key
  // shadowed everywhere applies nowhere and is reported as stale.
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

  const projectItems = inputs.project?.items;
  if (projectFilePath !== undefined && projectItems !== undefined) {
    processProjectScope({ projectFilePath, projectMap, projectItems, errors, globalMatchedRootKeys });
  }

  if (projectFilePath !== undefined) {
    collectRootStaleWarnings(projectFilePath, projectMap, globalMatchedRootKeys, warnings);
  }

  return { errors, warnings };
}

interface WorkspaceScopeArgs {
  workspace: { filePath: string; items: readonly OverrideTargetItem[]; map: Map<string, ChangelogOverride> };
  projectFilePath: string | undefined;
  projectMap: Map<string, ChangelogOverride>;
  errors: string[];
  warnings: string[];
  globalMatchedRootKeys: Set<string>;
}

/**
 * Validates one workspace scope: reports match errors, warns about workspace-tier stale keys, and adds the root keys
 * that match here without being shadowed to `globalMatchedRootKeys`.
 *
 * It applies the overrides once per file (the workspace map alone; the project map less its shadowed keys) so that each
 * error names the file that contains the offending key, and once more over the composed map, as `prepare` applies it,
 * to catch a root key and a workspace key that overlap on one item. The composed pass reports only the errors that
 * neither per-file pass reported, attributed to the workspace file. Stale detection counts any key that resolves, so a
 * key that errors is not also flagged as stale.
 */
function processWorkspaceScope(args: WorkspaceScopeArgs): void {
  const { workspace, projectFilePath, projectMap, errors, warnings, globalMatchedRootKeys } = args;
  const { filePath, items, map } = workspace;
  const validationEntries = makeValidationEntries(items);
  const positionsByHash = indexItemPositions(items);

  const workspaceApplied = applyChangelogOverrides(validationEntries, map);
  for (const message of workspaceApplied.errors) {
    errors.push(prefixWithFilePath(filePath, message));
  }

  if (projectFilePath !== undefined && projectMap.size > 0) {
    const projectMinusShadowed = filterShadowedKeys(projectMap, map);
    const projectApplied = applyChangelogOverrides(validationEntries, projectMinusShadowed);
    for (const message of projectApplied.errors) {
      errors.push(prefixWithFilePath(projectFilePath, message));
    }

    const perFileErrors = new Set([...workspaceApplied.errors, ...projectApplied.errors]);
    const composedApplied = applyChangelogOverrides(validationEntries, composeOverrides(projectMap, map));
    for (const message of composedApplied.errors) {
      if (!perFileErrors.has(message)) {
        errors.push(prefixWithFilePath(filePath, message));
      }
    }
  }

  for (const key of map.keys()) {
    if (!hasAnyMatch(key, positionsByHash)) {
      warnings.push(formatWorkspaceStaleWarning(filePath, key));
    }
  }

  for (const key of projectMap.keys()) {
    // Workspace-shadowed root keys do not count as root matches.
    if (map.has(key)) continue;
    if (hasAnyMatch(key, positionsByHash)) {
      globalMatchedRootKeys.add(key);
    }
  }
}

interface ProjectScopeArgs {
  projectFilePath: string;
  projectMap: Map<string, ChangelogOverride>;
  projectItems: readonly OverrideTargetItem[];
  errors: string[];
  globalMatchedRootKeys: Set<string>;
}

/**
 * Validates the project release scope: reports match errors and adds every matched root key to
 * `globalMatchedRootKeys`.
 */
function processProjectScope(args: ProjectScopeArgs): void {
  const { projectFilePath, projectMap, projectItems, errors, globalMatchedRootKeys } = args;
  const applied = applyChangelogOverrides(makeValidationEntries(projectItems), projectMap);
  for (const message of applied.errors) {
    errors.push(prefixWithFilePath(projectFilePath, message));
  }
  const positionsByHash = indexItemPositions(projectItems);
  for (const key of projectMap.keys()) {
    if (hasAnyMatch(key, positionsByHash)) {
      globalMatchedRootKeys.add(key);
    }
  }
}

/** Pushes a root-stale warning for every project key not already marked as matched. */
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

/** Reports whether `key` resolves to any item or to several commits; only a key that resolves to nothing is stale. */
function hasAnyMatch(key: string, positionsByHash: Map<string, Set<number | undefined>>): boolean {
  return resolveOverrideKey(key, positionsByHash).kind !== 'none';
}

/** Returns a new map of the `projectMap` entries whose keys do not appear in `workspaceMap`. */
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

/** Loads a scope's override map, pushing any load/schema errors (each prefixed with the file path) onto `errors`. */
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

/**
 * Builds a synthetic entry list whose items have the given hashes and entry positions, which is all that
 * `applyChangelogOverrides` matches on.
 */
function makeValidationEntries(items: readonly OverrideTargetItem[]): ChangelogEntry[] {
  return [
    {
      version: '0.0.0',
      date: '0000-00-00',
      sections: [
        {
          title: 'Validation',
          audience: 'all',
          items: items.map((item) => ({ ...item, description: '' })),
        },
      ],
    },
  ];
}

/** Prefixes a message with the path of the file to which it pertains. */
function prefixWithFilePath(filePath: string, message: string): string {
  return `${filePath}: ${message}`;
}

/** Formats the warning for a workspace key that matches no item in its workspace's history. */
function formatWorkspaceStaleWarning(filePath: string, key: string): string {
  return `${filePath}: Override key '${key}' did not match any item in this workspace's history (likely a stale reference)`;
}

/** Formats the warning for a root key that matches no item in any scope. */
function formatRootStaleWarning(filePath: string, key: string): string {
  return `${filePath}: Override key '${key}' did not match any item in any scope (likely a stale reference)`;
}

/**
 * Applies the composed root and workspace override map to a workspace's changelog entries, and records stale keys by
 * tier.
 *
 * A workspace key that matched nothing, whether or not the root map has the same key, is stale, and it is warned about
 * at once. A root key that matched without being shadowed joins `globalMatchedRootKeys`, from which the caller warns,
 * at the end of the run, about the root keys that matched nowhere. Throws if applying reports any error, such as an
 * ambiguous prefix.
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
  // Root tier: a matched key that the workspace map lacks came from `project`, the only other source of `composed`.
  for (const key of applied.matchedKeys) {
    if (workspaceOverrides?.has(key)) continue;
    globalMatchedRootKeys.add(key);
  }
  return applied;
}
