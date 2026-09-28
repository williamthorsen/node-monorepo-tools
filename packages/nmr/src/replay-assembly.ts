import { readCheckCacheEntry, type ReplayLine } from './check-cache.ts';
import { readNmrStep, type Step } from './steps.ts';
import { getWorkspacePackageDirs } from './workspace.ts';

/**
 * Assembles what a composite's skip replays: the excerpts recorded by its constituents, in the order in which
 * its own steps name them.
 *
 * A constituent that is itself a composite has a flat, attributed list of its own, so splicing one in keeps
 * the assembly flat and a skipped `ci` replays a package's `test` rather than one opaque `check:strict`
 * line. Nothing is computed and nothing is inferred: A constituent without an admissible entry is absent
 * from the assembly.
 *
 * A constituent is looked up at the scope at which its own process anchors: the composite's anchor, or the
 * monorepo root for an element that passes `-w`, which is how a package-scoped composite finds a root command's entry.
 *
 * An entry is admissible when the run that certified it is this one and the tree that it describes is this one.
 * The witness is what a run stamps on an excerpt that it records and on one that it recalls and replays; the
 * tree hash bounds an identity carried by a process out of the run that issued it.
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
 * Returns the scopes to which a delegate may have fanned out: every package in the workspace. Which of them the
 * delegate selected is left to the witness, so a `-F` pattern does not need any interpretation here and a
 * package that ran nothing contributes nothing.
 *
 * A directory without a workspace manifest does not have any packages to enumerate, which is the standalone
 * case.
 */
function resolveDelegateScopes(monorepoRoot: string): string[] {
  try {
    return getWorkspacePackageDirs(monorepoRoot);
  } catch {
    return [];
  }
}

// endregion | Helpers
