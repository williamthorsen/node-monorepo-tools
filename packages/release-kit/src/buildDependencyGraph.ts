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

    const packageJson = readPackageJsonSubset(primaryPackageFile);
    targetPackages.set(target, packageJson);

    if (typeof packageJson.version === 'string') {
      dirToVersion.set(target.id, packageJson.version);
    }

    if (packageJson.name === undefined) {
      continue;
    }

    packageNameToDir.set(packageJson.name, target.id);
    dirToPackageName.set(target.id, packageJson.name);
  }

  // Second pass: build the reverse and forward adjacency maps using cached package data.
  for (const [target, packageJson] of targetPackages) {
    const allDependencies = { ...packageJson.dependencies, ...packageJson.peerDependencies };

    for (const [dependencyName, dependencyVersion] of Object.entries(allDependencies)) {
      if (typeof dependencyVersion !== 'string' || !dependencyVersion.startsWith('workspace:')) {
        continue;
      }

      const existingDependents = dependentsOf.get(dependencyName);
      if (existingDependents === undefined) {
        dependentsOf.set(dependencyName, [target]);
      } else {
        existingDependents.push(target);
      }

      const forwardDependencies = dependenciesOf.get(target.id);
      if (forwardDependencies === undefined) {
        dependenciesOf.set(target.id, new Set([dependencyName]));
      } else {
        forwardDependencies.add(dependencyName);
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

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch (error: unknown) {
    throw chainError(`Failed to parse JSON in ${filePath}`, error);
  }

  if (!isPackageJsonSubset(parsedJson)) {
    throw new Error(`Invalid package.json at ${filePath}`);
  }

  return parsedJson;
}
