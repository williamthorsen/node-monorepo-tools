import type { DependencyGraph } from './buildDependencyGraph.ts';

/** Returns the start workspace `dir`s together with the `dir` of every workspace that depends on one, transitively. */
export function findTransitiveDependents(graph: DependencyGraph, startDirs: Iterable<string>): Set<string> {
  const found = new Set<string>(startDirs);
  const queue = [...found];

  while (queue.length > 0) {
    const dir = queue.shift();
    if (dir === undefined) break;

    const packageName = graph.dirToPackageName.get(dir);
    if (packageName === undefined) continue;

    const dependents = graph.dependentsOf.get(packageName) ?? [];
    for (const dependent of dependents) {
      if (found.has(dependent.dir)) continue;
      found.add(dependent.dir);
      queue.push(dependent.dir);
    }
  }

  return found;
}
