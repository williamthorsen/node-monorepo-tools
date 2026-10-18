import { type TreeSnapshot, writeDebugNote } from './check-cache.ts';
import type { BuildOutputState } from './check-cache-build-output.ts';
import { recordPass } from './check-cache-record.ts';
import type { HostRunResult } from './delegate-host.ts';
import type { RunPlan } from './invocation.ts';

/** What the check-result cache gates a run on: the key, the tree, and the build output that the run saw. */
export interface Gate {
  buildOutputBefore: BuildOutputState;
  key: string;
  retentionKey: string;
  snapshot: TreeSnapshot;
}

/**
 * Records a pass that the host earned, provided that the tree pushed to it is the tree on which the gate keyed: a
 * pass over any other tree says nothing about this one.
 */
export async function recordDelegatedPass(
  plan: RunPlan,
  gate: Gate,
  hostRun: Extract<HostRunResult, { kind: 'ran' }>,
): Promise<void> {
  const { anchorDir, command, context, env, stderr } = plan.invocation;

  if (hostRun.treeId !== gate.snapshot.treeId) {
    writeDebugNote(`not recording ${command}: the pushed tree is not the tree that the gate keyed on`, env, stderr);
    return;
  }

  await recordPass({
    anchorDir,
    buildOutputBefore: gate.buildOutputBefore,
    command,
    commandString: plan.commandString,
    config: context.config,
    durationMs: hostRun.durationMs,
    env,
    host: hostRun.host,
    key: gate.key,
    monorepoRoot: context.monorepoRoot,
    ownSteps: plan.ownSteps,
    retainedOutput: hostRun.retainedOutput,
    retentionKey: gate.retentionKey,
    runId: plan.runId,
    snapshot: gate.snapshot,
    stderr,
  });
}
