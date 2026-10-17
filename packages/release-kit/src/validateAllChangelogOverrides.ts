import { applyChangelogOverrides, indexItemPositions, resolveOverrideKey } from './applyChangelogOverrides.ts';
import { composeOverrides } from './changelogOverrides.ts';
import { loadChangelogOverrides } from './loadChangelogOverrides.ts';
import type { ChangelogEntry, ChangelogOverride } from './types.ts';

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

/** A changelog item as override matching sees it. `entry` is absent for a title-derived item. */
export interface OverrideTargetItem {
  hash: string;
  entry?: number;
}

/**
 * Validates every override file against the items of its scopes and returns the aggregated findings. It reads the
 * override files but doesn't collect any items: The caller supplies each scope's items.
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
   * Omit when the project file doesn't exist.
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

// region | Helpers

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

/** Formats the warning for a root key that doesn't match any item in any scope. */
function formatRootStaleWarning(filePath: string, key: string): string {
  return `${filePath}: Override key '${key}' did not match any item in any scope (likely a stale reference)`;
}

/** Formats the warning for a workspace key that doesn't match any item in its workspace's history. */
function formatWorkspaceStaleWarning(filePath: string, key: string): string {
  return `${filePath}: Override key '${key}' did not match any item in this workspace's history (likely a stale reference)`;
}

/** Reports whether `key` resolves to any item or to several commits; only a key that resolves to nothing is stale. */
function hasAnyMatch(key: string, positionsByHash: Map<string, Set<number | undefined>>): boolean {
  return resolveOverrideKey(key, positionsByHash).kind !== 'none';
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

interface WorkspaceScopeArgs {
  workspace: { filePath: string; items: readonly OverrideTargetItem[]; map: Map<string, ChangelogOverride> };
  projectFilePath: string | undefined;
  projectMap: Map<string, ChangelogOverride>;
  errors: string[];
  warnings: string[];
  globalMatchedRootKeys: Set<string>;
}

// endregion | Helpers
