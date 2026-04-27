import { describe, expect, it, vi } from 'vitest';

import type { DependencyGraph } from '../buildDependencyGraph.ts';
import type { WorkspaceConfig } from '../types.ts';
import {
  type CommitsProbeResult,
  validateOnlyExcludesStrandedDependents,
} from '../validateOnlyExcludesStrandedDependents.ts';

describe(validateOnlyExcludesStrandedDependents, () => {
  it('returns undefined when the targeted workspace has no internal dependents (case A)', () => {
    const a = makeWorkspace('a');
    const graph = makeGraph([a], {});
    const probe = makeProbe({ a: { has: true, tag: 'a-v1.0.0' } });

    const result = validateOnlyExcludesStrandedDependents([a], ['a'], graph, probe);

    expect(result).toBeUndefined();
  });

  it('returns undefined when a dependent has no commits (case B)', () => {
    const a = makeWorkspace('a');
    const b = makeWorkspace('b');
    const graph = makeGraph([a, b], { b: ['a'] });
    const probe = makeProbe({ a: { has: true, tag: 'a-v1.0.0' } });

    const result = validateOnlyExcludesStrandedDependents([a, b], ['a'], graph, probe);

    expect(result).toBeUndefined();
  });

  it('stops at an excluded no-commit dependent (case-3 barrier)', () => {
    // a (--only, has commits) <- b (excluded, no commits) <- c (excluded, has commits).
    // c must NOT be flagged: b is a barrier because excluded no-commit workspaces don't republish.
    const a = makeWorkspace('a');
    const b = makeWorkspace('b');
    const c = makeWorkspace('c');
    const graph = makeGraph([a, b, c], { b: ['a'], c: ['b'] });
    const probe = makeProbe({
      a: { has: true, tag: 'a-v1.0.0' },
      c: { has: true, tag: 'c-v1.0.0' },
    });

    const result = validateOnlyExcludesStrandedDependents([a, b, c], ['a'], graph, probe);

    expect(result).toBeUndefined();
  });

  it('flags a single excluded dependent with own commits (case C, direct)', () => {
    const a = makeWorkspace('a');
    const b = makeWorkspace('b');
    const graph = makeGraph([a, b], { b: ['a'] });
    const probe = makeProbe({
      a: { has: true, tag: 'a-v1.0.0' },
      b: { has: true, tag: 'b-v1.0.0' },
    });

    const result = validateOnlyExcludesStrandedDependents([a, b], ['a'], graph, probe);

    expect(result).toEqual([{ dir: 'b', downstreamOf: 'a', tag: 'b-v1.0.0' }]);
  });

  it('flags multiple excluded dependents at the same depth, sorted by dir', () => {
    const a = makeWorkspace('a');
    const b = makeWorkspace('b');
    const c = makeWorkspace('c');
    const graph = makeGraph([a, b, c], { b: ['a'], c: ['a'] });
    const probe = makeProbe({
      a: { has: true, tag: 'a-v1.0.0' },
      b: { has: true, tag: 'b-v1.0.0' },
      c: { has: true, tag: 'c-v1.0.0' },
    });

    const result = validateOnlyExcludesStrandedDependents([a, b, c], ['a'], graph, probe);

    expect(result).toEqual([
      { dir: 'b', downstreamOf: 'a', tag: 'b-v1.0.0' },
      { dir: 'c', downstreamOf: 'a', tag: 'c-v1.0.0' },
    ]);
  });

  it('catches the transitive case where B in --only bridges A to excluded D', () => {
    // --only=[a, b]. a has commits. b has none but depends on a (joins R via fixpoint).
    // c depends on b, c excluded with own commits → flagged as downstream of b.
    const a = makeWorkspace('a');
    const b = makeWorkspace('b');
    const c = makeWorkspace('c');
    const graph = makeGraph([a, b, c], { b: ['a'], c: ['b'] });
    const probe = makeProbe({
      a: { has: true, tag: 'a-v1.0.0' },
      c: { has: true, tag: 'c-v1.0.0' },
    });

    const result = validateOnlyExcludesStrandedDependents([a, b, c], ['a', 'b'], graph, probe);

    expect(result).toEqual([{ dir: 'c', downstreamOf: 'b', tag: 'c-v1.0.0' }]);
  });

  it('walks through anticipated-fix dependents to surface deeper footguns in one pass', () => {
    // a (--only, has commits) <- b (excluded, has commits) <- c (excluded, has commits).
    // Both b and c must be flagged in a single pass.
    const a = makeWorkspace('a');
    const b = makeWorkspace('b');
    const c = makeWorkspace('c');
    const graph = makeGraph([a, b, c], { b: ['a'], c: ['b'] });
    const probe = makeProbe({
      a: { has: true, tag: 'a-v1.0.0' },
      b: { has: true, tag: 'b-v1.0.0' },
      c: { has: true, tag: 'c-v1.0.0' },
    });

    const result = validateOnlyExcludesStrandedDependents([a, b, c], ['a'], graph, probe);

    expect(result).toEqual([
      { dir: 'b', downstreamOf: 'a', tag: 'b-v1.0.0' },
      { dir: 'c', downstreamOf: 'b', tag: 'c-v1.0.0' },
    ]);
  });

  it('returns undefined when no --only workspace has commits and none gain entry via propagation', () => {
    const a = makeWorkspace('a');
    const x = makeWorkspace('x');
    const graph = makeGraph([a, x], {});
    const probe = makeProbe({}); // neither has commits

    const result = validateOnlyExcludesStrandedDependents([a, x], ['a', 'x'], graph, probe);

    expect(result).toBeUndefined();
  });

  it('does not walk through --only workspaces that are not in R', () => {
    // a (--only, no commits), b (--only, no commits but depends on nothing in R), c (excluded with commits, depends on b).
    // Neither a nor b joins R (no source of commits). c must not be flagged.
    const a = makeWorkspace('a');
    const b = makeWorkspace('b');
    const c = makeWorkspace('c');
    const graph = makeGraph([a, b, c], { c: ['b'] });
    const probe = makeProbe({ c: { has: true, tag: 'c-v1.0.0' } });

    const result = validateOnlyExcludesStrandedDependents([a, b, c], ['a', 'b'], graph, probe);

    expect(result).toBeUndefined();
  });

  it('preserves the tag value (including undefined) from the probe', () => {
    const a = makeWorkspace('a');
    const b = makeWorkspace('b');
    const graph = makeGraph([a, b], { b: ['a'] });
    const probe = makeProbe({
      a: { has: true, tag: 'a-v1.0.0' },
      b: { has: true, tag: undefined },
    });

    const result = validateOnlyExcludesStrandedDependents([a, b], ['a'], graph, probe);

    expect(result).toEqual([{ dir: 'b', downstreamOf: 'a', tag: undefined }]);
  });

  it('memoizes hasCommits — each workspace is probed at most once', () => {
    const a = makeWorkspace('a');
    const b = makeWorkspace('b');
    const c = makeWorkspace('c');
    const graph = makeGraph([a, b, c], { b: ['a'], c: ['a'] });
    const calls = new Map<string, number>();
    const spy = vi.fn((workspace: WorkspaceConfig): CommitsProbeResult => {
      calls.set(workspace.dir, (calls.get(workspace.dir) ?? 0) + 1);
      if (workspace.dir === 'a') return { has: true, tag: 'a-v1.0.0' };
      if (workspace.dir === 'b') return { has: true, tag: 'b-v1.0.0' };
      return { has: true, tag: 'c-v1.0.0' };
    });

    validateOnlyExcludesStrandedDependents([a, b, c], ['a'], graph, spy);

    expect(calls.get('a')).toBe(1);
    expect(calls.get('b')).toBe(1);
    expect(calls.get('c')).toBe(1);
  });
});

// region | Helpers
/**
 * Build a `DependencyGraph` from a textual edge spec without touching the filesystem.
 *
 * `edges` maps each workspace `dir` to the set of workspace `dir`s it depends on. The
 * returned graph mirrors the shape produced by `buildDependencyGraph` so the validator
 * sees identical structure.
 */
function makeGraph(workspaces: WorkspaceConfig[], edges: Record<string, string[]>): DependencyGraph {
  const packageNameToDir = new Map<string, string>();
  const dirToPackageName = new Map<string, string>();
  for (const w of workspaces) {
    packageNameToDir.set(w.name, w.dir);
    dirToPackageName.set(w.dir, w.name);
  }

  const dependentsOf = new Map<string, WorkspaceConfig[]>();
  const dependenciesOf = new Map<string, Set<string>>();
  const workspaceByDir = new Map(workspaces.map((w) => [w.dir, w] as const));

  for (const [dir, deps] of Object.entries(edges)) {
    const forward = new Set<string>();
    for (const depDir of deps) {
      const depWorkspace = workspaceByDir.get(depDir);
      if (depWorkspace === undefined) {
        throw new Error(`makeGraph: ${dir} depends on unknown ${depDir}`);
      }
      forward.add(depWorkspace.name);
      const dependentWorkspace = workspaceByDir.get(dir);
      if (dependentWorkspace === undefined) {
        throw new Error(`makeGraph: unknown dependent ${dir}`);
      }
      const list = dependentsOf.get(depWorkspace.name);
      if (list === undefined) {
        dependentsOf.set(depWorkspace.name, [dependentWorkspace]);
      } else {
        list.push(dependentWorkspace);
      }
    }
    if (forward.size > 0) {
      dependenciesOf.set(dir, forward);
    }
  }

  return { packageNameToDir, dirToPackageName, dependentsOf, dependenciesOf };
}

/** Build a `hasCommits` probe from a map of `dir` to `{ has, tag }`. Defaults to no commits. */
function makeProbe(map: Record<string, CommitsProbeResult>): (workspace: WorkspaceConfig) => CommitsProbeResult {
  return (workspace) => map[workspace.dir] ?? { has: false, tag: undefined };
}

/** Build a minimal `WorkspaceConfig` keyed by `dir` (and a matching `name` derived from it). */
function makeWorkspace(dir: string): WorkspaceConfig {
  return {
    dir,
    name: `@scope/${dir}`,
    tagPrefix: `${dir}-v`,
    workspacePath: `packages/${dir}`,
    packageFiles: [`packages/${dir}/package.json`],
    changelogPaths: [`packages/${dir}`],
    paths: [`packages/${dir}`],
  };
}
// endregion | Helpers
