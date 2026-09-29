import type { DependencyGraph } from './buildDependencyGraph.ts';
import { bumpVersion } from './bumpVersion.ts';
import type { PropagationSource, ReleaseType } from './types.ts';

/** Entry in the full release set produced by propagation. */
export interface ReleaseEntry {
  releaseType: ReleaseType;
  /** Present when this workspace was bumped (wholly or partly) due to a dependency update. */
  propagatedFrom?: PropagationSource[];
  /**
   * Explicit new version, which dependents record in their `propagatedFrom.newVersion` entry in place of a version
   * computed from `releaseType`.
   */
  newVersionOverride?: string;
}

/**
 * Walks upward through the dependency graph breadth-first, adding a `patch` bump for each dependent
 * not already in the release set.
 *
 * Returns the full release set (direct + propagated). An entry already in the set that also has a
 * propagated dependency gains `propagatedFrom` metadata without a change to its bump type.
 */
export function propagateBumps(
  directBumps: Map<string, ReleaseEntry>,
  graph: DependencyGraph,
): Map<string, ReleaseEntry> {
  const result = new Map<string, ReleaseEntry>();

  // Copy each entry: The loop below appends to `propagatedFrom` on existing entries.
  for (const [dir, entry] of directBumps) {
    result.set(dir, { ...entry });
  }

  // BFS queue: Workspace dirs whose dependents need to be checked.
  const queue: string[] = directBumps.keys().toArray();
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

    const packageName = graph.dirToPackageName.get(dir);
    if (packageName === undefined) {
      continue;
    }

    const currentVersion = graph.dirToVersion.get(dir);
    const entry = result.get(dir);
    if (currentVersion === undefined || entry === undefined) {
      continue;
    }
    const newVersion = entry.newVersionOverride ?? bumpVersion(currentVersion, entry.releaseType);

    const dependents = graph.dependentsOf.get(packageName);
    if (dependents === undefined) {
      continue;
    }

    for (const dependent of dependents) {
      const dependentDir = dependent.dir;
      const existing = result.get(dependentDir);

      const propagationInfo = { packageName, newVersion };

      if (existing === undefined) {
        result.set(dependentDir, {
          releaseType: 'patch',
          propagatedFrom: [propagationInfo],
        });
      } else {
        // Already in the release set. Add propagatedFrom metadata but don't downgrade the bump.
        const existingPropagated = existing.propagatedFrom ?? [];
        existing.propagatedFrom = [...existingPropagated, propagationInfo];
      }

      // Enqueue the dependent so that its own dependents are checked (transitive propagation).
      if (!visited.has(dependentDir)) {
        queue.push(dependentDir);
      }
    }
  }

  return result;
}
