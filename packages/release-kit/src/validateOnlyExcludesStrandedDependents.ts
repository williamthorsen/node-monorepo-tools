import type { DependencyGraph } from './buildDependencyGraph.ts';
import type { WorkspaceConfig } from './types.ts';

/** Result of probing a workspace's commits since its last tag. */
export interface CommitsProbeResult {
  /** Whether the workspace has any commits since its last tag (excluding `release:` commits). */
  has: boolean;
  /** The baseline tag from which the commits were measured; `undefined` when the workspace does not have a prior tag. */
  tag: string | undefined;
}

/** A single excluded workspace whose changes would be stranded by the `--only` invocation. */
export interface StrandedDependentViolation {
  /** The excluded workspace's `dir`. */
  dir: string;
  /** The `dir` of the released (or anticipated-release) dependency whose release republishes this workspace. */
  downstreamOf: string;
  /**
   * The baseline tag from which this workspace's commits were counted; `undefined` if the workspace does not have a
   * prior tag.
   */
  tag: string | undefined;
}

/** Probe callback that returns whether a workspace has commits since its last tag. */
type CommitsProbe = (workspace: WorkspaceConfig) => CommitsProbeResult;

/**
 * Detects `--only` invocations that would silently strand changes in excluded internal dependents.
 *
 * First computes R, the `--only` workspaces that will release, then walks the reverse-dependency graph breadth-first
 * from R and records each excluded workspace with its own commits as a violation. The walk continues through a
 * violation, as though the user had added it to `--only`, which reports deeper violations in the same pass. It stops
 * at an excluded workspace without commits, which does not republish, so its dependents are unaffected by R.
 *
 * Returns `undefined` when the walk does not find any violation, or the violations sorted by `dir`.
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

/** Wraps a commits probe with a per-workspace cache so that each workspace is queried at most once. */
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
 * Computes R, the set of `--only` workspaces that will release.
 *
 * Initial members are `--only` workspaces with their own commits since their last tag. The fixpoint adds `--only`
 * workspaces that depend on a member of R, since those will release via propagation.
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

/** Reports whether `dir` declares a `workspace:` dependency on any workspace in `released`. */
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
 * Walks the reverse-dependency graph breadth-first from R and returns each excluded dependent with commits as a
 * violation.
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
  const queue: BfsFrontierItem[] = [];

  for (const dir of released) {
    const packageName = graph.dirToPackageName.get(dir);
    if (packageName !== undefined) {
      queue.push({ packageName, attributionRoot: dir });
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
      visitDependent(dependent, item.attributionRoot, {
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

/**
 * One node in the BFS frontier: a released or anticipated-release workspace. `attributionRoot` is its `dir`, which a
 * violation among its dependents cites as `downstreamOf`.
 */
interface BfsFrontierItem {
  packageName: string;
  attributionRoot: string;
}

interface VisitDependentContext {
  released: ReadonlySet<string>;
  onlySet: ReadonlySet<string>;
  graph: DependencyGraph;
  probeCommits: CommitsProbe;
  queue: BfsFrontierItem[];
  violations: StrandedDependentViolation[];
  violationDirs: Set<string>;
}

/** Classifies a single dependent: skip, walk-through, or record as a violation (and walk through). */
function visitDependent(dependent: WorkspaceConfig, attributionRoot: string, ctx: VisitDependentContext): void {
  if (ctx.onlySet.has(dependent.dir)) {
    // Walk through an `--only` dependent only when it is in R; one outside R does not have any commits or any
    // propagation source, so it does not release.
    if (ctx.released.has(dependent.dir)) {
      enqueueDependent(dependent, ctx);
    }
    return;
  }

  const probe = ctx.probeCommits(dependent);
  if (!probe.has) return; // An excluded dependent without commits does not republish.

  if (!ctx.violationDirs.has(dependent.dir)) {
    ctx.violationDirs.add(dependent.dir);
    ctx.violations.push({
      dir: dependent.dir,
      downstreamOf: attributionRoot,
      tag: probe.tag,
    });
  }

  // Walk through the violation as though the user had added it to `--only`.
  enqueueDependent(dependent, ctx);
}

/** Pushes the dependent onto the BFS queue as the attribution root for violations among its own dependents. */
function enqueueDependent(dependent: WorkspaceConfig, ctx: VisitDependentContext): void {
  const packageName = ctx.graph.dirToPackageName.get(dependent.dir);
  if (packageName !== undefined) {
    ctx.queue.push({ packageName, attributionRoot: dependent.dir });
  }
}
