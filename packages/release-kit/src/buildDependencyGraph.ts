import { readFileSync } from 'node:fs';

import { chainError } from '@williamthorsen/toolbelt.errors/candidate';

import type { PackageTarget } from './types.ts';

/** Identities, current versions, and `workspace:` dependency edges of the package targets. */
export interface DependencyGraph {
  /** Maps a package name to its target id, the workspace `dir`. */
  packageNameToDir: Map<string, string>;
  /** Maps a target id (a workspace `dir`) to its package name (inverse of `packageNameToDir`). */
  dirToPackageName: Map<string, string>;
  /** Maps a target id to its current version; absent when its `package.json` doesn't have a string `version`. */
  dirToVersion: Map<string, string>;
  /** Maps a package name to the targets that depend on it. */
  dependentsOf: Map<string, PackageTarget[]>;
  /**
   * Maps a target id to the `workspace:`-protocol package names that it declares in `dependencies` or
   * `peerDependencies` (the forward counterpart of `dependentsOf`).
   */
  dependenciesOf: Map<string, Set<string>>;
}

interface PackageJsonSubset {
  name?: string;
  version?: unknown;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/** Reports whether a parsed value is an object, which the graph reads as a `package.json` subset. */
function isPackageJsonSubset(value: unknown): value is PackageJsonSubset {
  return typeof value === 'object' && value !== null;
}

/**
 * Builds the dependency graph from the package targets' `package.json` files.
 *
 * Reads each target's primary `package.json` (first entry in `versionFiles`) to discover
 * `workspace:` references in `dependencies` and `peerDependencies`, and to record its current
 * version.
 */
export function buildDependencyGraph(targets: readonly PackageTarget[]): DependencyGraph {
  const packageNameToDir = new Map<string, string>();
  const dirToPackageName = new Map<string, string>();
  const dirToVersion = new Map<string, string>();
  const dependentsOf = new Map<string, PackageTarget[]>();
  const dependenciesOf = new Map<string, Set<string>>();

  // First pass: read each target's package.json, cache the result, and register its name and version.
  const targetPackages = new Map<PackageTarget, PackageJsonSubset>();
  for (const target of targets) {
    const primaryPackageFile = target.versionFiles[0];
    if (primaryPackageFile === undefined) {
      continue;
    }

    const pkg = readPackageJsonSubset(primaryPackageFile);
    targetPackages.set(target, pkg);

    if (typeof pkg.version === 'string') {
      dirToVersion.set(target.id, pkg.version);
    }

    if (pkg.name === undefined) {
      continue;
    }

    packageNameToDir.set(pkg.name, target.id);
    dirToPackageName.set(target.id, pkg.name);
  }

  // Second pass: build the reverse and forward adjacency maps using cached package data.
  for (const [target, pkg] of targetPackages) {
    const allDeps = { ...pkg.dependencies, ...pkg.peerDependencies };

    for (const [depName, depVersion] of Object.entries(allDeps)) {
      if (typeof depVersion !== 'string' || !depVersion.startsWith('workspace:')) {
        continue;
      }

      const existing = dependentsOf.get(depName);
      if (existing === undefined) {
        dependentsOf.set(depName, [target]);
      } else {
        existing.push(target);
      }

      const forward = dependenciesOf.get(target.id);
      if (forward === undefined) {
        dependenciesOf.set(target.id, new Set([depName]));
      } else {
        forward.add(depName);
      }
    }
  }

  return { packageNameToDir, dirToPackageName, dirToVersion, dependentsOf, dependenciesOf };
}

/** Reads and parses a `package.json` file as the subset of fields that the graph reads. */
function readPackageJsonSubset(filePath: string): PackageJsonSubset {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (error: unknown) {
    throw chainError(`Failed to read ${filePath}`, error);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    throw chainError(`Failed to parse JSON in ${filePath}`, error);
  }

  if (!isPackageJsonSubset(parsed)) {
    throw new Error(`Invalid package.json at ${filePath}`);
  }

  return parsed;
}
