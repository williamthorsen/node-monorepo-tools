import { readFileSync } from 'node:fs';

import type { ComponentConfig } from './types.ts';

/** Reverse adjacency map from package names to their workspace dependents. */
export interface DependencyGraph {
  /** Resolve a package name to its component `dir`. */
  packageNameToDir: Map<string, string>;
  /** Resolve a component `dir` to its package name (inverse of `packageNameToDir`). */
  dirToPackageName: Map<string, string>;
  /** Map a package name to the components that depend on it. */
  dependentsOf: Map<string, ComponentConfig[]>;
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
 * Build a reverse dependency graph from the workspace components' `package.json` files.
 *
 * Reads each component's primary `package.json` (first entry in `packageFiles`) to discover
 * `workspace:` references in `dependencies` and `peerDependencies`. Returns a map from each
 * package name to the components that depend on it, enabling upward traversal from a bumped
 * package to all its dependents.
 */
export function buildDependencyGraph(components: readonly ComponentConfig[]): DependencyGraph {
  const packageNameToDir = new Map<string, string>();
  const dirToPackageName = new Map<string, string>();
  const dependentsOf = new Map<string, ComponentConfig[]>();

  // First pass: read each component's package.json, cache the result, and register its name.
  const componentPackages = new Map<ComponentConfig, PackageJsonSubset>();
  for (const component of components) {
    const primaryPackageFile = component.packageFiles[0];
    if (primaryPackageFile === undefined) {
      continue;
    }

    const pkg = readPackageJsonSubset(primaryPackageFile);
    componentPackages.set(component, pkg);

    if (pkg.name === undefined) {
      continue;
    }

    packageNameToDir.set(pkg.name, component.dir);
    dirToPackageName.set(component.dir, pkg.name);
  }

  // Second pass: build the reverse adjacency map using cached package data.
  for (const [component, pkg] of componentPackages) {
    const allDeps = { ...pkg.dependencies, ...pkg.peerDependencies };

    for (const [depName, depVersion] of Object.entries(allDeps)) {
      if (typeof depVersion !== 'string' || !depVersion.startsWith('workspace:')) {
        continue;
      }

      const existing = dependentsOf.get(depName);
      if (existing === undefined) {
        dependentsOf.set(depName, [component]);
      } else {
        existing.push(component);
      }
    }
  }

  return { packageNameToDir, dirToPackageName, dependentsOf };
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
