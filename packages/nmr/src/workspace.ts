import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';

import { readStringValues } from './helpers/readStringValues.ts';
import { isObject } from './helpers/type-guards.ts';
import { matchPackageDirs, resolvePackageDirs, splitWorkspacePatterns } from './helpers/workspace-patterns.ts';
import { UserError } from './UserError.ts';

/** The manifest a package's name is declared in. */
const PACKAGE_MANIFEST = 'package.json';

/** The manifest whose presence marks a directory as the monorepo root. */
const WORKSPACE_MANIFEST = 'pnpm-workspace.yaml';

/** Which of three conditions left a workspace resolving to no package directory. */
export type EmptyWorkspaceCause = 'all-excluded' | 'no-manifest' | 'no-pattern';

/**
 * Why a workspace resolved to no package directory, together with the `packages` list its manifest declares.
 *
 * The patterns travel with the cause because every message composed from one quotes them back to the reader.
 */
export interface EmptyWorkspaceDiagnosis {
  cause: EmptyWorkspaceCause;
  patterns: string[];
}

/** Reports whether a directory is the monorepo root, which the workspace manifest's presence marks. */
export function isMonorepoRoot(dir: string): boolean {
  return existsSync(path.join(dir, WORKSPACE_MANIFEST));
}

/**
 * Finds the monorepo root by walking up from `startDir` to find `pnpm-workspace.yaml`.
 * Throws if no workspace root is found.
 */
export function findMonorepoRoot(startDir?: string): string {
  let dir = path.resolve(startDir ?? process.cwd());

  for (;;) {
    if (isMonorepoRoot(dir)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new UserError(`Could not find monorepo root: no ${WORKSPACE_MANIFEST} found in any parent directory`);
    }
    dir = parent;
  }
}

/**
 * Reads the workspace patterns from `pnpm-workspace.yaml` and resolves them to absolute package
 * directories, applying pnpm's pattern semantics — including `!`-prefixed exclusions.
 *
 * Returns an empty array when the manifest declares no usable `packages` list, and throws when
 * `monorepoRoot` holds no manifest at all — the caller named a directory that is not a monorepo root.
 */
export function getWorkspacePackageDirs(monorepoRoot: string): string[] {
  return resolvePackageDirs(monorepoRoot, readWorkspacePatterns(monorepoRoot));
}

/**
 * Reports which of three conditions left a workspace with no package directory, for a caller that has already
 * resolved one and found it empty.
 *
 * Reaches the filesystem a second time for `all-excluded` alone, re-matching the positive patterns without the
 * exclusion set. That runs on a diagnostic path, where a workspace resolution has already failed.
 *
 * `no-pattern` covers every manifest whose `packages` key reaches the matcher with nothing positive: a key that
 * is absent, empty, not a list of strings, or holds only `!` entries. One remedy answers all four, so the
 * conditions below them are not worth telling apart.
 */
export function diagnoseEmptyWorkspace(monorepoRoot: string): EmptyWorkspaceDiagnosis {
  const patterns = readWorkspacePatterns(monorepoRoot);
  const { excludedPatterns, includedPatterns } = splitWorkspacePatterns(patterns);

  if (includedPatterns.length === 0) {
    return { cause: 'no-pattern', patterns };
  }

  if (excludedPatterns.length > 0 && matchPackageDirs(monorepoRoot, includedPatterns, []).length > 0) {
    return { cause: 'all-excluded', patterns };
  }

  return { cause: 'no-manifest', patterns };
}

/**
 * Reads the `overrides` block from the monorepo root's `pnpm-workspace.yaml`, the site pnpm reads an override
 * from.
 *
 * Returns nothing when the manifest or the block is missing, and drops an entry whose value is not a string.
 */
export function readWorkspaceOverrides(monorepoRoot: string): Record<string, string> | undefined {
  const workspaceFile = path.join(monorepoRoot, WORKSPACE_MANIFEST);

  if (!existsSync(workspaceFile)) {
    return undefined;
  }

  const parsedManifest: unknown = parse(readFileSync(workspaceFile, 'utf8'));
  if (!isObject(parsedManifest)) {
    return undefined;
  }

  const overrides = parsedManifest['overrides'];

  return isObject(overrides) ? readStringValues(overrides) : undefined;
}

/**
 * Reads the manifest `name` each of the given package directories declares, which is what a `-F` pattern
 * matches.
 *
 * A directory whose manifest is missing, unparseable, or nameless contributes nothing. The sweep runs for a
 * diagnostic's sake, so one malformed manifest elsewhere in the workspace must not replace the diagnostic the
 * reader asked for with a failure of its own.
 */
export function readWorkspacePackageNames(packageDirs: readonly string[]): string[] {
  const names: string[] = [];

  for (const dir of packageDirs) {
    let parsedManifest: unknown;
    try {
      parsedManifest = JSON.parse(readFileSync(path.join(dir, PACKAGE_MANIFEST), 'utf8'));
    } catch {
      continue;
    }
    if (isObject(parsedManifest) && typeof parsedManifest['name'] === 'string') {
      names.push(parsedManifest['name']);
    }
  }

  return names;
}

// region | Helpers

/**
 * Reads the `packages` list a parsed workspace manifest declares, or nothing where it declares no usable one:
 * no `packages` key, a key that is not a list, or a list holding something other than strings.
 */
function getPackagesFromParsedYaml(parsed: unknown): string[] | undefined {
  if (!isObject(parsed)) return undefined;
  const packages = parsed['packages'];
  if (!Array.isArray(packages)) return undefined;
  if (!packages.every((p): p is string => typeof p === 'string')) return undefined;
  return packages;
}

/**
 * Reads the `packages` list the monorepo root's `pnpm-workspace.yaml` declares.
 *
 * Returns an empty list where the manifest declares no usable one, and throws where the manifest itself is
 * absent: the caller named a directory that is not a monorepo root.
 */
function readWorkspacePatterns(monorepoRoot: string): string[] {
  const workspaceFile = path.join(monorepoRoot, WORKSPACE_MANIFEST);

  if (!existsSync(workspaceFile)) {
    throw new UserError(`Not a monorepo root: no ${WORKSPACE_MANIFEST} in ${monorepoRoot}`);
  }

  const parsedManifest: unknown = parse(readFileSync(workspaceFile, 'utf8'));

  return getPackagesFromParsedYaml(parsedManifest) ?? [];
}

// endregion | Helpers
