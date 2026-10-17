import path from 'node:path';

import { applyChangelogOverrides, formatStaleOverrideKeyWarning } from './applyChangelogOverrides.ts';
import { loadChangelogOverrides } from './loadChangelogOverrides.ts';
import type { ChangelogEntry, ChangelogOverride } from './types.ts';

/** Conventional override-file location relative to a scope root (project, workspace, or single-package). */
const OVERRIDES_FILENAME = '.meta/changelog-overrides.json';

/**
 * Applies the composed root and workspace override map to a target's changelog entries, and records stale keys by
 * tier. A target without a workspace override file, such as the project, passes `undefined` for `workspacePath` and
 * applies the root tier alone.
 *
 * A workspace key that matched nothing, whether or not the root map has the same key, is stale, and it is warned about
 * at once. The function adds each root key that matched without being shadowed to `globalMatchedRootKeys`, from which
 * the caller warns, at the end of the run, about the root keys that matched nowhere. Throws if applying reports any
 * error, such as an ambiguous prefix.
 */
export function applyWorkspaceOverrides(
  newEntries: ChangelogEntry[],
  workspacePath: string | undefined,
  overrideContext: OverrideContext,
): ReturnType<typeof applyChangelogOverrides> {
  const { project, perWorkspace, overrideWarnings, globalMatchedRootKeys } = overrideContext;
  const workspaceOverrides = workspacePath === undefined ? undefined : perWorkspace.get(workspacePath);
  const composed = composeOverrides(project, workspaceOverrides);
  const applied = applyChangelogOverrides(newEntries, composed);
  if (applied.errors.length > 0) {
    throw new Error(`Changelog override application failed:\n  - ${applied.errors.join('\n  - ')}`);
  }
  overrideWarnings.push(...applied.warnings);

  const matchedSet = new Set(applied.matchedKeys);
  // Workspace tier: Every workspace key not in the matched set is stale here and now.
  if (workspaceOverrides !== undefined) {
    for (const key of workspaceOverrides.keys()) {
      if (!matchedSet.has(key)) {
        overrideWarnings.push(formatStaleOverrideKeyWarning(key));
      }
    }
  }
  // Root tier: A matched key that the workspace map lacks came from `project`, the only other source of `composed`.
  for (const key of applied.matchedKeys) {
    if (workspaceOverrides?.has(key)) continue;
    globalMatchedRootKeys.add(key);
  }
  return applied;
}

/**
 * Composes root and workspace override maps into the effective map for one workspace, without mutating either.
 *
 * A workspace key identical to a root key replaces the root entry entirely, without a field-level merge. Distinct keys
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
 * Loads and validates the override files of the root and of every workspace at the given repo-relative paths, and
 * bundles them with empty warning aggregators. Throws if any file fails to load, so that a malformed checked-in
 * override file stops `prepare` before any workspace writes.
 */
export function createOverrideContext(workspacePaths: readonly string[]): OverrideContext {
  const result = loadOverridesForScopes({ project: '.', workspaces: [...workspacePaths] });
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
 * The loaded per-scope override maps and the run's warning aggregators, shared by every apply of a prepare run.
 *
 * `globalMatchedRootKeys` contains the root keys matched in any apply. Workspace keys are not added: A workspace key
 * that matches nothing in its own workspace is stale, and it is warned about at once rather than at the end of the run.
 */
export interface OverrideContext {
  project: Map<string, ChangelogOverride>;
  perWorkspace: Map<string, Map<string, ChangelogOverride>>;
  overrideWarnings: string[];
  globalMatchedRootKeys: Set<string>;
}

/**
 * Resolves the conventional override-file path for a scope root: the directory in which a scope's other artifacts live
 * (e.g., `'.'` for the project, `'packages/foo'` for a workspace). The returned path is repo-relative.
 */
export function resolveOverridePath(scopeRoot: string): string {
  return path.posix.join(scopeRoot, OVERRIDES_FILENAME);
}
