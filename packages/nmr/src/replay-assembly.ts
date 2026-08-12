import type { ReplayLine } from './check-cache.ts';
import { readCheckCacheEntry } from './check-cache.ts';
import type { Step } from './steps.ts';
import { readNmrStep } from './steps.ts';
import { getWorkspacePackageDirs } from './workspace.ts';

/**
 * Assembles what a composite's skip replays: the excerpts its constituents recorded, in the order its own
 * steps name them.
 *
 * A constituent that is itself a composite holds a flat, attributed list of its own, so splicing one in keeps
 * the assembly flat and a skipped `ci` replays a package's `test:coverage` rather than one opaque
 * `check:strict` line. Nothing is computed and nothing is inferred: a constituent with no admissible entry is
 * absent from the assembly.
 *
 * A constituent is looked up at the scope its own process anchors at: the composite's anchor, or the monorepo
 * root for an element carrying `-w`, which is how a package-scoped composite reaches a root command.
 *
 * An entry is admissible where the run that certified it is this one and the tree it describes is this one.
 * The witness is what a run stamps on an excerpt it records and on one it recalls and replays; the tree hash
 * is what bounds an identity a process carried out of the run that issued it.
 */
export async function assembleReplay(options: {
  anchorDir: string;
  monorepoRoot: string;
  runId: string;
  steps: readonly Step[];
  treeHash: string;
}): Promise<ReplayLine[]> {
  const { anchorDir, monorepoRoot, runId, steps, treeHash } = options;

  const candidates = steps.flatMap((step) => {
    const target = readNmrStep(step);
    if (target === undefined) {
      return [];
    }

    const scopeDirs = target.isDelegate
      ? resolveDelegateScopes(monorepoRoot)
      : [target.isWorkspaceRoot ? monorepoRoot : anchorDir];

    return scopeDirs.map((scopeDir) => ({ anchorDir: scopeDir, command: target.command, monorepoRoot }));
  });

  const entries = await Promise.all(candidates.map((candidate) => readCheckCacheEntry(candidate)));

  return entries.flatMap((entry) =>
    entry?.treeHash === treeHash && entry.retention?.runId === runId ? entry.retention.replay : [],
  );
}

// region | Helpers

/**
 * Returns the scopes a delegate may have fanned out to: every package the workspace holds. Which of them the
 * delegate selected is left to the witness, so a `-F` pattern needs no interpretation here and a package that
 * ran nothing contributes nothing.
 *
 * A directory holding no workspace manifest has no packages to enumerate, which is the standalone case.
 */
function resolveDelegateScopes(monorepoRoot: string): string[] {
  try {
    return getWorkspacePackageDirs(monorepoRoot);
  } catch {
    return [];
  }
}

// endregion | Helpers
