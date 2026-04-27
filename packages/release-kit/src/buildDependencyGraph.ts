import { readFileSync } from 'node:fs';

import type { WorkspaceConfig } from './types.ts';

/** Reverse adjacency map from package names to their workspace dependents. */
export interface DependencyGraph {
  /** Resolve a package name to its workspace `dir`. */
  packageNameToDir: Map<string, string>;
  /** Resolve a workspace `dir` to its package name (inverse of `packageNameToDir`). */
  dirToPackageName: Map<string, string>;
  /** Map a package name to the workspaces that depend on it. */
  dependentsOf: Map<string, WorkspaceConfig[]>;
  /**
   * Forward adjacency: map a workspace `dir` to the set of `workspace:`-protocol package
   * names it declares in `dependencies` or `peerDependencies`. Complement of `dependentsOf`.
   */
  dependenciesOf: Map<string, Set<string>>;
}

interface PackageJsonSubset {
  name?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function isPackageJsonSubset(value: unknown): value is PackageJsonSubset {
  return typeof value === 'object' && value !== null;
}

/**
 * Build a reverse dependency graph from the workspaces' `package.json` files.
 *
 * Reads each workspace's primary `package.json` (first entry in `packageFiles`) to discover
 * `workspace:` references in `dependencies` and `peerDependencies`. Returns a map from each
 * package name to the workspaces that depend on it, enabling upward traversal from a bumped
 * package to all its dependents.
 */
export function buildDependencyGraph(workspaces: readonly WorkspaceConfig[]): DependencyGraph {
  const packageNameToDir = new Map<string, string>();
  const dirToPackageName = new Map<string, string>();
  const dependentsOf = new Map<string, WorkspaceConfig[]>();
  const dependenciesOf = new Map<string, Set<string>>();

  // First pass: read each workspace's package.json, cache the result, and register its name.
  const workspacePackages = new Map<WorkspaceConfig, PackageJsonSubset>();
  for (const workspace of workspaces) {
    const primaryPackageFile = workspace.packageFiles[0];
    if (primaryPackageFile === undefined) {
      continue;
    }

    const pkg = readPackageJsonSubset(primaryPackageFile);
    workspacePackages.set(workspace, pkg);

    if (pkg.name === undefined) {
      continue;
    }

    packageNameToDir.set(pkg.name, workspace.dir);
    dirToPackageName.set(workspace.dir, pkg.name);
  }

  // Second pass: build the reverse and forward adjacency maps using cached package data.
  for (const [workspace, pkg] of workspacePackages) {
    const allDeps = { ...pkg.dependencies, ...pkg.peerDependencies };

    for (const [depName, depVersion] of Object.entries(allDeps)) {
      if (typeof depVersion !== 'string' || !depVersion.startsWith('workspace:')) {
        continue;
      }

      const existing = dependentsOf.get(depName);
      if (existing === undefined) {
        dependentsOf.set(depName, [workspace]);
      } else {
        existing.push(workspace);
      }

      const forward = dependenciesOf.get(workspace.dir);
      if (forward === undefined) {
        dependenciesOf.set(workspace.dir, new Set([depName]));
      } else {
        forward.add(depName);
      }
    }
  }

  return { packageNameToDir, dirToPackageName, dependentsOf, dependenciesOf };
}

/** Read and parse a package.json file, returning only the fields needed for graph building. */
function readPackageJsonSubset(filePath: string): PackageJsonSubset {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (error: unknown) {
    throw new Error(`Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    throw new Error(`Failed to parse JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isPackageJsonSubset(parsed)) {
    throw new Error(`Invalid package.json at ${filePath}`);
  }

  return parsed;
}
