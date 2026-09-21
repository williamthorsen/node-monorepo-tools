import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';

import { matchPackageDirs, resolvePackageDirs, splitWorkspacePatterns } from './helpers/workspace-patterns.ts';

/** The manifest a package's name is declared in. */
const PACKAGE_MANIFEST = 'package.json';

/** The manifest whose presence marks a directory as the monorepo root. */
const WORKSPACE_MANIFEST = 'pnpm-workspace.yaml';

/** Which of six conditions left a workspace resolving to no package directory. */
export type EmptyWorkspaceCause =
  'all-excluded' | 'no-package' | 'no-packages-list' | 'no-pattern' | 'unreadable-manifest' | 'unreadable-packages';

/**
 * What resolving a directory's workspace patterns produced: the directory declares no workspace, it resolves
 * to a set of package directories, or it resolves to none and the cause says which condition emptied it.
 *
 * The declared patterns travel with the last two because a message composed from one quotes them back to the
 * reader. They are empty under `unreadable-manifest`, the one cause whose manifest declares nothing the reader
 * can see.
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
  const manifestRead = readWorkspaceManifest(monorepoRoot);
  if (manifestRead.kind !== 'parsed' || !isObject(manifestRead.value)) {
    return undefined;
  }

  const overrides = manifestRead.value['overrides'];

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
 * Three causes separate what a manifest declares from what the reader could make of it, because one remedy
 * does not answer them all. `no-packages-list` is a manifest declaring nothing, an absent `packages` key or an
 * empty list, which pnpm resolves to the root package alone; `unreadable-packages` is a `packages` value that
 * is not a list of strings, which declares something the reader refused; and `no-pattern` is a list whose
 * entries all fail to become a positive pattern, `!` entries and entries YAML emptied. A caller treating an
 * empty resolution as a failure needs the first held apart from the other two, and a caller composing a
 * message needs all three.
 *
 * A manifest that the reader cannot parse at all is `unreadable-manifest`. It declares whatever it declares,
 * and the remedy the pattern causes share — declare a positive pattern — repairs nothing for a reader who has
 * one and a syntax error above it.
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
 * could not make patterns of, or it declares patterns.
 *
 * Four shapes count as declaring none, because each asks the same of the matcher and pnpm resolves each to
 * the root package alone: a manifest holding no document at all, which an empty or comment-only file parses
 * to, a manifest holding no `packages` key, a `packages` key whose value YAML read as null, and an empty
 * list.
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
 * What reading the monorepo root's workspace manifest produced: the directory holds none, the reader could not
 * read or parse the one it holds, or it parsed to a value.
 *
 * An absent manifest is what makes a directory no workspace at all, and an unreadable one is a workspace whose
 * declarations nobody can see, so the two are told apart rather than sharing an absent value.
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
