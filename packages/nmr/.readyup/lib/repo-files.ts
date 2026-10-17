import { globSync } from 'node:fs';
import { basename, join, sep } from 'node:path';

import { describeError } from '@williamthorsen/toolbelt.errors';
import type { CheckOutcome } from 'readyup';
import { discoverWorkspaces, readFile, type Workspace } from 'readyup/check-utils';

/** Directories whose contents are generated or vendored, and so are never the source of a finding. */
const SCAN_EXCLUDE_DIRS = new Set(['.git', 'coverage', 'dist', 'node_modules']);

/** Either the repo's workspaces or the reason discovery could not enumerate them. */
type WorkspaceDiscovery = { ok: true; workspaces: Workspace[] } | { ok: false; detail: string };

/** Extensions that a Vite or Vitest config can take. */
export const CONFIG_EXTENSIONS = '{ts,mts,cts,js,mjs,cjs}';

/** Reports every file matching the given patterns, passing when there are none. */
export function checkNoMatchingFiles(patterns: string[], cwd: string): boolean | CheckOutcome {
  const foundFiles = findFiles(patterns, cwd);
  if (foundFiles.length === 0) return true;
  return { ok: false, detail: formatPaths(foundFiles) };
}

/**
 * Returns the workspaces that pass the filter, every one when it is omitted, or the reason discovery could not
 * enumerate them.
 *
 * A failure is returned rather than thrown, because readyup catches a throw at kit level and one would abort
 * the rest of the checklist; it is returned rather than swallowed, because an empty list turns every check
 * built on this one into a pass over a repo about which it verified nothing. Discovery throws when the root
 * manifest is unreadable, and when the workspace globs use a YAML or glob feature that readyup's discovery
 * does not support, a negation pattern among them.
 *
 * A check built on this reads `process.cwd()` and cannot offer a directory of its own: readyup's public entry
 * exports `discoverWorkspaces` alone, not the `discoverWorkspacesAt(dir)` form declared in its source.
 */
export function discoverWorkspacesOrFailure(filter?: (workspace: Workspace) => boolean): WorkspaceDiscovery {
  try {
    return { ok: true, workspaces: discoverWorkspaces(filter === undefined ? undefined : { filter }) };
  } catch (error) {
    return { ok: false, detail: `cannot enumerate workspaces: ${describeError(error)}` };
  }
}

/**
 * Globs for the given patterns, pruning generated and vendored directories.
 *
 * The comparison has to be against the path's basename, because the `exclude` callback receives a path relative
 * to `cwd` rather than a bare name. An identity check would prune only at depth 0 and miss the per-package
 * `node_modules` directories created by pnpm.
 *
 * Returns POSIX-separator paths, sorted, so that check details are stable across platforms and runs.
 */
export function findFiles(patterns: string[], cwd: string): string[] {
  return globSync(patterns, { cwd, exclude: (path) => SCAN_EXCLUDE_DIRS.has(basename(path)) })
    .map((path) => path.split(sep).join('/'))
    .toSorted();
}

/**
 * Renders offending paths as a work list rather than a boolean, one per line under a count.
 *
 * The indent clears readyup's three-space nesting step so that a path does not read as a nested check.
 */
export function formatPaths(paths: string[]): string {
  return `${paths.length} found:\n${paths.map((path) => `      ${path}`).join('\n')}`;
}

/**
 * Checks whether a config imports a named export from one of nmr's shared-config modules.
 *
 * `defineVitestConfig` does not match inside `defineRootVitestConfig`, so the `vitest.config` and
 * `vitest.root.config` checks cannot satisfy each other.
 */
export function importsSharedExport(content: string | undefined, exportName: string, moduleSpecifier: string): boolean {
  if (content === undefined) return false;
  const pattern = new RegExp(String.raw`import\s*\{[^}]*\b${exportName}\b[^}]*\}\s*from\s*['"]${moduleSpecifier}['"]`);
  return pattern.test(content);
}

/** Reads a file resolved against `cwd`, returning undefined when it is absent. */
export function readFileIn(cwd: string, relativePath: string): string | undefined {
  return readFile(join(cwd, relativePath));
}
