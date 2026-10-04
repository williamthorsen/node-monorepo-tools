import { describe, expect, it } from 'vitest';

import type { DependencyGraph } from '../buildDependencyGraph.ts';
import { findTransitiveDependents } from '../findTransitiveDependents.ts';
import type { WorkspaceConfig } from '../types.ts';

describe(findTransitiveDependents, () => {
  // core <- app <- cli, core <- cli, and the unrelated util.
  const graph = makeGraph(['core', 'app', 'cli', 'util'], {
    core: ['app', 'cli'],
    app: ['cli'],
  });

  it('returns the start dirs with every transitive dependent, each once', () => {
    expect(findTransitiveDependents(graph, ['core'])).toStrictEqual(new Set(['core', 'app', 'cli']));
  });

  it('leaves out the dependencies of a start dir', () => {
    expect(findTransitiveDependents(graph, ['app'])).toStrictEqual(new Set(['app', 'cli']));
  });

  it('returns a start dir that is absent from the graph without any dependents', () => {
    expect(findTransitiveDependents(graph, ['util', 'unknown'])).toStrictEqual(new Set(['util', 'unknown']));
  });
});

// region | Helpers
/** Builds a graph of `@test/{dir}` packages from each dir's dependent dirs. */
function makeGraph(dirs: string[], dependentDirsOf: Record<string, string[]>): DependencyGraph {
  return {
    packageNameToDir: new Map(dirs.map((dir) => [`@test/${dir}`, dir])),
    dirToPackageName: new Map(dirs.map((dir) => [dir, `@test/${dir}`])),
    dirToVersion: new Map(),
    dependentsOf: new Map(
      Object.entries(dependentDirsOf).map(([dir, dependents]) => [`@test/${dir}`, dependents.map(makeWorkspace)]),
    ),
    dependenciesOf: new Map(),
  };
}

/** Builds a publishable workspace config under `packages/{dir}`. */
function makeWorkspace(dir: string): WorkspaceConfig {
  return {
    dir,
    name: `@test/${dir}`,
    tagPrefix: `${dir}-v`,
    workspacePath: `packages/${dir}`,
    isPublishable: true,
    packageFiles: [`packages/${dir}/package.json`],
    changelogPaths: [`packages/${dir}`],
    paths: [`packages/${dir}/**`],
  };
}
// endregion | Helpers
