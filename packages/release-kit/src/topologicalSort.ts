import type { DependencyGraph } from './buildDependencyGraph.ts';
import type { ReleaseEntry } from './propagateBumps.ts';

/**
 * Sorts target ids topologically so that dependencies are processed before their dependents.
 *
 * Uses Kahn's algorithm. Targets not in the release set are excluded. If the graph has
 * cycles, the remaining nodes are appended in arbitrary order and reported via `cyclicIds`.
 */
export function topologicalSort(
  releaseSet: Map<string, ReleaseEntry>,
  graph: DependencyGraph,
): { sortedIds: string[]; cyclicIds: string[] } {
  const releaseIds = new Set(releaseSet.keys());
  if (releaseIds.size === 0) {
    return { sortedIds: [], cyclicIds: [] };
  }

  // Build a forward adjacency list (dependency -> dependent) restricted to the release set.
  const inDegree = new Map<string, number>();
  const forwardEdges = new Map<string, string[]>();

  for (const id of releaseIds) {
    inDegree.set(id, 0);
    forwardEdges.set(id, []);
  }

  // Add an edge for each dependency-dependent pair inside the release set.
  for (const [packageName, dependents] of graph.dependentsOf) {
    const dependencyId = graph.packageNameToDir.get(packageName);
    if (dependencyId === undefined || !releaseIds.has(dependencyId)) {
      continue;
    }

    for (const dependent of dependents) {
      if (!releaseIds.has(dependent.id)) {
        continue;
      }

      const edges = forwardEdges.get(dependencyId);
      if (edges !== undefined) {
        edges.push(dependent.id);
      }

      inDegree.set(dependent.id, (inDegree.get(dependent.id) ?? 0) + 1);
    }
  }

  // Kahn's algorithm.
  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  const sortedIds: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) {
      break;
    }
    sortedIds.push(id);

    const dependents = forwardEdges.get(id) ?? [];
    for (const dependent of dependents) {
      const newDegree = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) {
        queue.push(dependent);
      }
    }
  }

  // Append any remaining (cyclic) nodes.
  const sortedSet = new Set(sortedIds);
  const cyclicIds: string[] = [];
  for (const id of releaseIds) {
    if (sortedSet.has(id)) {
      continue;
    }

    sortedIds.push(id);
    cyclicIds.push(id);
  }

  return { sortedIds, cyclicIds };
}
