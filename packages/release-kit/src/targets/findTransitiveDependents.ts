import type { DependencyGraph } from './buildDependencyGraph.ts';

/** Returns the start workspace `dir`s together with the `dir` of every workspace that depends on one, transitively. */
export function findTransitiveDependents(graph: DependencyGraph, startDirs: Iterable<string>): Set<string> {
  const foundDirs = new Set<string>(startDirs);
  const queue = [...foundDirs];

  while (queue.length > 0) {
    const dir = queue.shift();
    if (dir === undefined) break;

    const packageName = graph.dirToPackageName.get(dir);
    if (packageName === undefined) continue;

    const dependents = graph.dependentsOf.get(packageName) ?? [];
    for (const dependent of dependents) {
      if (foundDirs.has(dependent.id)) continue;
      foundDirs.add(dependent.id);
      queue.push(dependent.id);
    }
  }

  return foundDirs;
}
