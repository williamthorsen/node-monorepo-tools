import type { DependencyGraph } from './buildDependencyGraph.ts';
import type { WorkspaceConfig } from './types.ts';

/** Result of probing a workspace's commits since its last tag. */
export interface CommitsProbeResult {
  /** Whether the workspace has any commits since its last tag (excluding `release:` commits). */
  has: boolean;
  /** The baseline tag the commits were measured from; `undefined` when no prior tag exists. */
  tag: string | undefined;
}

/** A single excluded workspace whose changes would be stranded by the `--only` invocation. */
export interface StrandedDependentViolation {
  /** The excluded workspace's `dir`. */
  dir: string;
  /** The released workspace's `dir` whose release would have triggered D's republication. */
  downstreamOf: string;
  /** The baseline tag from which D's commits were counted; `undefined` if no prior tag. */
  tag: string | undefined;
}

/** Probe callback that returns whether a workspace has commits since its last tag. */
type CommitsProbe = (workspace: WorkspaceConfig) => CommitsProbeResult;

/**
 * Detect `--only` invocations that would silently strand changes in excluded internal dependents.
 *
 * Runs in two steps. First, compute the released `--only` set R via fixpoint: start with `--only`
 * workspaces that have own commits, then iteratively add `--only` workspaces whose `workspace:`
 * deps land in R (those will release via propagation). Second, BFS through the reverse-dep graph
 * starting from R, recording each excluded workspace with own commits as a violation. The walk
 * continues *through* such workspaces (anticipating that the user will add them to `--only`,
 * surfacing deeper footguns in one pass), but stops at excluded workspaces with no commits
 * (case-3 barriers — they don't republish, so their downstream dependents aren't affected by R).
 *
 * Returns `undefined` when no violations are found, or a sorted list otherwise.
 */
export function validateOnlyExcludesStrandedDependents(
  workspaces: readonly WorkspaceConfig[],
  only: readonly string[],
  graph: DependencyGraph,
  hasCommits: CommitsProbe,
): StrandedDependentViolation[] | undefined {
  const probeCommits = memoizeCommitsProbe(hasCommits);
  const workspaceByDir = new Map(workspaces.map((w) => [w.dir, w] as const));

  const released = computeReleasedSet(only, workspaceByDir, graph, probeCommits);
  const violations = collectStrandedViolations(released, new Set(only), graph, probeCommits);

  if (violations.length === 0) return undefined;
  violations.sort((a, b) => a.dir.localeCompare(b.dir));
  return violations;
}

// region | Helpers

/** Wrap a commits probe with a per-workspace cache so each workspace is queried at most once. */
function memoizeCommitsProbe(probe: CommitsProbe): CommitsProbe {
  const cache = new Map<string, CommitsProbeResult>();
  return (workspace) => {
    const cached = cache.get(workspace.dir);
    if (cached !== undefined) return cached;
    const result = probe(workspace);
    cache.set(workspace.dir, result);
    return result;
  };
}

/**
 * Compute R: the set of `--only` workspaces that will release.
 *
 * Initial members are `--only` workspaces with their own commits since their last tag. The fixpoint
 * adds `--only` workspaces whose internal deps land in R, since those will release via propagation.
 */
function computeReleasedSet(
  only: readonly string[],
  workspaceByDir: ReadonlyMap<string, WorkspaceConfig>,
  graph: DependencyGraph,
  probeCommits: CommitsProbe,
): Set<string> {
  const released = new Set<string>();
  for (const dir of only) {
    const workspace = workspaceByDir.get(dir);
    if (workspace !== undefined && probeCommits(workspace).has) {
      released.add(dir);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const dir of only) {
      if (released.has(dir)) continue;
      if (hasDependencyIn(dir, graph, released)) {
        released.add(dir);
        changed = true;
      }
    }
  }
  return released;
}

/** Whether `dir` declares a `workspace:` dep on any workspace in `released`. */
function hasDependencyIn(dir: string, graph: DependencyGraph, released: ReadonlySet<string>): boolean {
  const forwardDeps = graph.dependenciesOf.get(dir);
  if (forwardDeps === undefined) return false;
  for (const depPackageName of forwardDeps) {
    const depDir = graph.packageNameToDir.get(depPackageName);
    if (depDir !== undefined && released.has(depDir)) return true;
  }
  return false;
}

/**
 * BFS through the reverse-dep graph starting from R; record excluded changed dependents as
 * violations. Walks *through* recorded violations (anticipated user fix), but stops at excluded
 * no-commit dependents (case-3 barriers).
 */
function collectStrandedViolations(
  released: ReadonlySet<string>,
  onlySet: ReadonlySet<string>,
  graph: DependencyGraph,
  probeCommits: CommitsProbe,
): StrandedDependentViolation[] {
  const violations: StrandedDependentViolation[] = [];
  const violationDirs = new Set<string>();
  const visited = new Set<string>();
  const queue: { packageName: string; releasedAncestor: string }[] = [];

  for (const dir of released) {
    const packageName = graph.dirToPackageName.get(dir);
    if (packageName !== undefined) {
      queue.push({ packageName, releasedAncestor: dir });
    }
  }

  while (queue.length > 0) {
    const item = queue.shift();
    if (item === undefined) break;
    if (visited.has(item.packageName)) continue;
    visited.add(item.packageName);

    const dependents = graph.dependentsOf.get(item.packageName);
    if (dependents === undefined) continue;

    for (const dependent of dependents) {
      visitDependent(dependent, item.releasedAncestor, {
        released,
        onlySet,
        graph,
        probeCommits,
        queue,
        violations,
        violationDirs,
      });
    }
  }

  return violations;
}

interface VisitDependentContext {
  released: ReadonlySet<string>;
  onlySet: ReadonlySet<string>;
  graph: DependencyGraph;
  probeCommits: CommitsProbe;
  queue: { packageName: string; releasedAncestor: string }[];
  violations: StrandedDependentViolation[];
  violationDirs: Set<string>;
}

/** Classify a single dependent: skip, walk-through, or record as a violation (and walk through). */
function visitDependent(dependent: WorkspaceConfig, releasedAncestor: string, ctx: VisitDependentContext): void {
  if (ctx.onlySet.has(dependent.dir)) {
    // Walk through `--only` dependents only when they will actually release (i.e., are in R).
    // A `--only` workspace not in R has no commits and no propagation source — it doesn't
    // release, so we should not propagate the walk through it.
    if (ctx.released.has(dependent.dir)) {
      enqueueDependent(dependent, dependent.dir, ctx);
    }
    return;
  }

  const probe = ctx.probeCommits(dependent);
  if (!probe.has) return; // Case-3 barrier: excluded with no commits.

  if (!ctx.violationDirs.has(dependent.dir)) {
    ctx.violationDirs.add(dependent.dir);
    ctx.violations.push({
      dir: dependent.dir,
      downstreamOf: releasedAncestor,
      tag: probe.tag,
    });
  }

  // Walk through the violating dependent: anticipate the user adding it to `--only`,
  // which would put it in R and surface any deeper footguns in this same pass.
  enqueueDependent(dependent, dependent.dir, ctx);
}

/** Push the dependent onto the BFS queue using its package name as the new frontier key. */
function enqueueDependent(dependent: WorkspaceConfig, releasedAncestor: string, ctx: VisitDependentContext): void {
  const packageName = ctx.graph.dirToPackageName.get(dependent.dir);
  if (packageName !== undefined) {
    ctx.queue.push({ packageName, releasedAncestor });
  }
}
