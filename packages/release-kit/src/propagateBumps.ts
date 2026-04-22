import type { DependencyGraph } from './buildDependencyGraph.ts';
import { bumpVersion } from './bumpVersion.ts';
import type { PropagationSource, ReleaseType } from './types.ts';

/** Entry in the full release set produced by propagation. */
export interface ReleaseEntry {
  releaseType: ReleaseType;
  /** Present when this workspace was bumped (wholly or partly) due to a dependency update. */
  propagatedFrom?: PropagationSource[];
  /**
   * Explicit new version override used for propagation metadata. When set, dependents see this
   * value in their `propagatedFrom.newVersion` entry instead of a version computed from `releaseType`.
   * Used by the `--set-version` CLI path so propagation reflects the overridden version.
   */
  newVersionOverride?: string;
}

/** Map from workspace `dir` to its current version string (read from package.json). */
export type CurrentVersions = Map<string, string>;

/**
 * Walk upward through the dependency graph via BFS, adding `patch` bumps for dependents
 * not already in the release set with a higher bump.
 *
 * Returns the full release set (direct + propagated). Direct entries that also have a
 * propagated dependency get `propagatedFrom` metadata without changing their bump type.
 */
export function propagateBumps(
  directBumps: Map<string, ReleaseEntry>,
  graph: DependencyGraph,
  currentVersions: CurrentVersions,
): Map<string, ReleaseEntry> {
  const result = new Map<string, ReleaseEntry>();

  // Copy direct bumps into the result.
  for (const [dir, entry] of directBumps) {
    result.set(dir, { ...entry });
  }

  // BFS queue: workspace dirs whose dependents need to be checked.
  const queue: string[] = [...directBumps.keys()];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const dir = queue.shift();
    if (dir === undefined) {
      break;
    }

    if (visited.has(dir)) {
      continue;
    }
    visited.add(dir);

    // Resolve the package name for this workspace dir.
    const packageName = graph.dirToPackageName.get(dir);
    if (packageName === undefined) {
      continue;
    }

    // Compute the new version for this workspace after its bump.
    const currentVersion = currentVersions.get(dir);
    const entry = result.get(dir);
    if (currentVersion === undefined || entry === undefined) {
      continue;
    }
    // Prefer the explicit override (--set-version) when present; otherwise compute from releaseType.
    const newVersion = entry.newVersionOverride ?? bumpVersion(currentVersion, entry.releaseType);

    // Find dependents and propagate.
    const dependents = graph.dependentsOf.get(packageName);
    if (dependents === undefined) {
      continue;
    }

    for (const dependent of dependents) {
      const dependentDir = dependent.dir;
      const existing = result.get(dependentDir);

      const propagationInfo = { packageName, newVersion };

      if (existing === undefined) {
        // New propagated entry.
        result.set(dependentDir, {
          releaseType: 'patch',
          propagatedFrom: [propagationInfo],
        });
      } else {
        // Already in the release set. Add propagatedFrom metadata but don't downgrade the bump.
        const existingPropagated = existing.propagatedFrom ?? [];
        existing.propagatedFrom = [...existingPropagated, propagationInfo];
      }

      // Enqueue the dependent so its own dependents are checked (transitive propagation).
      if (!visited.has(dependentDir)) {
        queue.push(dependentDir);
      }
    }
  }

  return result;
}
