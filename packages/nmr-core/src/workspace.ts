import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';

import { matchPackageDirs, resolvePackageDirs, splitWorkspacePatterns } from './helpers/workspace-patterns.ts';

/** The manifest a package's name is declared in. */
const PACKAGE_MANIFEST = 'package.json';

/** The manifest whose presence marks a directory as the monorepo root. */
const WORKSPACE_MANIFEST = 'pnpm-workspace.yaml';

/** Which of three conditions left a workspace resolving to no package directory. */
export type EmptyWorkspaceCause = 'all-excluded' | 'no-package' | 'no-pattern';

/**
 * What resolving a directory's workspace patterns produced: the directory declares no workspace, it resolves
 * to a set of package directories, or it resolves to none and the cause says which condition emptied it.
 *
 * The declared patterns travel with the last two because every message composed from one quotes them back to
 * the reader.
 */
export type WorkspaceResolution =
  | { kind: 'empty'; cause: EmptyWorkspaceCause; patterns: string[] }
  | { kind: 'not-a-workspace' }
  | { kind: 'packages'; packageDirs: string[]; patterns: string[] };

/**
 * Finds the monorepo root by walking up from `startDir`, defaulting to `process.cwd()`, until it reaches a
 * directory holding `pnpm-workspace.yaml`.
 *
 * Returns nothing where the walk runs out of parent directories, which a CLI turns into whichever failure its
 * own error boundary calls for.
 */
export function findMonorepoRoot(startDir?: string): string | undefined {
  let dir = path.resolve(startDir ?? process.cwd());

  for (;;) {
    if (isMonorepoRoot(dir)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/** Reports whether a directory is the monorepo root, which the workspace manifest's presence marks. */
export function isMonorepoRoot(dir: string): boolean {
  return existsSync(path.join(dir, WORKSPACE_MANIFEST));
}

/**
 * Reads the `overrides` block from the monorepo root's `pnpm-workspace.yaml`, the site pnpm reads an override
 * from.
 *
 * Returns nothing when the manifest is missing, unreadable, unparseable, or declares no block, and drops an
 * entry whose value is not a string.
 */
export function readWorkspaceOverrides(monorepoRoot: string): Record<string, string> | undefined {
  const parsedManifest = readWorkspaceManifest(monorepoRoot);
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

/**
 * Resolves the workspace a directory declares, applying pnpm's pattern semantics — including `!`-prefixed
 * exclusions — and reporting which condition left the result empty.
 *
 * Reaches the filesystem a second time for `all-excluded` alone, re-matching the positive patterns without the
 * exclusion set. That runs only where a resolution has already come back empty.
 *
 * `no-pattern` covers every manifest whose `packages` key reaches the matcher with nothing positive: a key that
 * is absent, empty, not a list of strings, or holding only `!` entries, and a manifest that cannot be read or
 * parsed at all. One remedy answers them all, so the conditions below them are not worth telling apart.
 */
export function resolveWorkspace(monorepoRoot: string): WorkspaceResolution {
  const patterns = readWorkspacePatterns(monorepoRoot);
  if (patterns === undefined) {
    return { kind: 'not-a-workspace' };
  }

  const packageDirs = resolvePackageDirs(monorepoRoot, patterns);
  if (packageDirs.length > 0) {
    return { kind: 'packages', packageDirs, patterns };
  }

  return { cause: diagnoseEmptyCause(monorepoRoot, patterns), kind: 'empty', patterns };
}

// region | Helpers

/** Reports which condition left a workspace whose patterns resolved to no package directory. */
function diagnoseEmptyCause(monorepoRoot: string, patterns: readonly string[]): EmptyWorkspaceCause {
  const { excludedPatterns, includedPatterns } = splitWorkspacePatterns(patterns);

  if (includedPatterns.length === 0) {
    return 'no-pattern';
  }

  if (excludedPatterns.length > 0 && matchPackageDirs(monorepoRoot, includedPatterns, []).length > 0) {
    return 'all-excluded';
  }

  return 'no-package';
}

/**
 * Reads the `packages` list a parsed workspace manifest declares, or nothing where it declares no usable one:
 * no `packages` key, a key that is not a list, or a list holding something other than strings.
 */
function getPackagesFromParsedYaml(parsedManifest: unknown): string[] | undefined {
  if (!isObject(parsedManifest)) return undefined;
  const packages = parsedManifest['packages'];
  if (!Array.isArray(packages)) return undefined;
  if (!packages.every((p): p is string => typeof p === 'string')) return undefined;
  return packages;
}

/** Narrows an unknown value to a record, which is the shape a parsed manifest has to have to be read. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Keeps the entries whose value is a string, dropping the rest.
 *
 * A manifest reader that rejected the whole record over one bad value would report nothing about the entries
 * beside it, which for a reporter is silence where there is something to say. YAML's implicit typing makes
 * that easy to reach without malformed intent: an unquoted `18` parses as a number.
 */
function readStringValues(record: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

/**
 * Parses the monorepo root's `pnpm-workspace.yaml`, returning nothing where it is absent, unreadable, or
 * holds no valid YAML.
 */
function readWorkspaceManifest(monorepoRoot: string): unknown {
  const workspaceFile = path.join(monorepoRoot, WORKSPACE_MANIFEST);

  if (!existsSync(workspaceFile)) {
    return undefined;
  }

  try {
    return parse(readFileSync(workspaceFile, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Reads the `packages` list the monorepo root's `pnpm-workspace.yaml` declares.
 *
 * Returns nothing where the directory holds no manifest, which is what makes it no workspace at all, and an
 * empty list where the manifest declares no usable one.
 */
function readWorkspacePatterns(monorepoRoot: string): string[] | undefined {
  if (!isMonorepoRoot(monorepoRoot)) {
    return undefined;
  }

  return getPackagesFromParsedYaml(readWorkspaceManifest(monorepoRoot)) ?? [];
}

// endregion | Helpers
