import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';

import { matchPackageDirs, resolvePackageDirs, splitWorkspacePatterns } from './helpers/workspace-patterns.ts';

const PACKAGE_MANIFEST = 'package.json';

const WORKSPACE_MANIFEST = 'pnpm-workspace.yaml';

/**
 * The condition that left a workspace resolving to no package directory. Each calls for a different remedy:
 *
 * - `all-excluded`: The positive patterns match packages, and the exclusions remove every one.
 * - `no-package`: The positive patterns match no package.
 * - `no-packages-list`: The manifest declares no pattern list, which pnpm resolves to the root package alone.
 * - `no-pattern`: No entry of the list is a positive pattern, as with `!` entries and entries that YAML emptied.
 * - `unreadable-manifest`: The manifest cannot be read or parsed, whatever patterns it may declare.
 * - `unreadable-packages`: The `packages` value is not a list of strings.
 */
export type EmptyWorkspaceCause =
  'all-excluded' | 'no-package' | 'no-packages-list' | 'no-pattern' | 'unreadable-manifest' | 'unreadable-packages';

/**
 * What resolving a directory's workspace patterns produced: the directory declares no workspace, it resolves
 * to a set of package directories, or it resolves to none and the cause says which condition emptied it.
 *
 * The declared patterns travel with the last two because a message composed from one quotes them back to the
 * reader. They are empty when the manifest yields no pattern list.
 */
export type WorkspaceResolution =
  | { kind: 'empty'; cause: EmptyWorkspaceCause; patterns: string[] }
  | { kind: 'not-a-workspace' }
  | { kind: 'packages'; packageDirs: string[]; patterns: string[] };

/**
 * Finds the monorepo root by walking up from `startDir`, defaulting to `process.cwd()`, to the first directory
 * holding `pnpm-workspace.yaml`, or returns `undefined` when no ancestor holds one.
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
  const manifestRead = readWorkspaceManifest(monorepoRoot);
  if (manifestRead.kind !== 'parsed' || !isObject(manifestRead.value)) {
    return undefined;
  }

  const overrides = manifestRead.value['overrides'];

  return isObject(overrides) ? readStringValues(overrides) : undefined;
}

/**
 * Reads the manifest `name` that each of the given package directories declares, skipping a directory whose
 * manifest is missing, unparseable, or nameless.
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
 * Reaches the filesystem a second time only when the resolution is empty, re-matching the positive patterns
 * without the exclusions to tell `all-excluded` from `no-package`.
 */
export function resolveWorkspace(monorepoRoot: string): WorkspaceResolution {
  const manifestRead = readWorkspaceManifest(monorepoRoot);
  if (manifestRead.kind === 'absent') {
    return { kind: 'not-a-workspace' };
  }
  if (manifestRead.kind === 'unreadable') {
    return { cause: 'unreadable-manifest', kind: 'empty', patterns: [] };
  }

  const packagesRead = readDeclaredPackages(manifestRead.value);
  if (packagesRead.kind !== 'patterns') {
    const cause = packagesRead.kind === 'absent' ? 'no-packages-list' : 'unreadable-packages';

    return { cause, kind: 'empty', patterns: [] };
  }

  const { patterns } = packagesRead;

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
 * What reading a parsed manifest's `packages` key produced: it declares no list, it declares one the reader
 * could not make patterns of, or it declares patterns. An empty list counts as none, because pnpm resolves an
 * empty list, like an absent one, to the root package alone.
 */
type PackagesRead = { kind: 'absent' } | { kind: 'patterns'; patterns: string[] } | { kind: 'unreadable' };

/** Reads the `packages` list a parsed workspace manifest declares, reporting an absent list apart from an unreadable one. */
function readDeclaredPackages(parsedManifest: unknown): PackagesRead {
  if (!isObject(parsedManifest)) return { kind: 'absent' };

  const packages = parsedManifest['packages'];
  if (packages === undefined || packages === null) return { kind: 'absent' };
  if (!Array.isArray(packages)) return { kind: 'unreadable' };
  if (!packages.every((entry): entry is string => typeof entry === 'string')) return { kind: 'unreadable' };

  return packages.length === 0 ? { kind: 'absent' } : { kind: 'patterns', patterns: packages };
}

/** Narrows an unknown value to a record, which is the shape a parsed manifest has to have to be read. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Keeps the entries whose value is a string, so that one bad value does not hide the entries beside it. YAML's
 * implicit typing produces such a value easily: an unquoted `18` parses as a number.
 */
function readStringValues(record: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

/**
 * What reading the monorepo root's workspace manifest produced: the directory holds none, the reader could not
 * read or parse the one it holds, or it parsed to a value. An absent manifest makes a directory no workspace at
 * all; an unreadable one belongs to a workspace whose declarations the reader cannot see.
 */
type ManifestRead = { kind: 'absent' } | { kind: 'parsed'; value: unknown } | { kind: 'unreadable' };

/** Parses the monorepo root's `pnpm-workspace.yaml`, reporting an absent manifest apart from an unreadable one. */
function readWorkspaceManifest(monorepoRoot: string): ManifestRead {
  const workspaceFile = path.join(monorepoRoot, WORKSPACE_MANIFEST);

  if (!existsSync(workspaceFile)) {
    return { kind: 'absent' };
  }

  try {
    return { kind: 'parsed', value: parse(readFileSync(workspaceFile, 'utf8')) };
  } catch {
    return { kind: 'unreadable' };
  }
}

// endregion | Helpers
