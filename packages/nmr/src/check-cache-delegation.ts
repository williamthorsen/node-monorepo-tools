import path from 'node:path';

import { resolveTreeSnapshot, type TreeSnapshot, writeDebugNote } from './check-cache.ts';
import type { BuildOutputState } from './check-cache-build-output.ts';
import type { ReplayLine, Retention } from './check-cache-entries.ts';
import { computeCacheKey, computeRetentionKey } from './check-cache-key.ts';
import { recordHostPass } from './check-cache-record.ts';
import type { HostRunResult } from './delegate-host.ts';
import { type RunPlan, VERSION } from './invocation.ts';
import type { OutputChannels } from './output-channel.ts';
import { formatManifestScope, type PassManifestEntry, validatePassManifest } from './pass-manifest.ts';

/** What the check-result cache gates a run on: the key, the tree, and the build output that the run saw. */
export interface Gate {
  buildOutputBefore: BuildOutputState;
  /** The channels on which the invocation's output runs, which every retention key that it records folds. */
  channels: OutputChannels;
  key: string;
  retentionKey: string;
  snapshot: TreeSnapshot;
}

/**
 * Records the passes that the host earned, provided that the tree pushed to it is the tree on which the gate keyed,
 * and that the working tree did not move while the host ran: a pass over any other tree says nothing about this one.
 *
 * Each valid entry of the host's pass manifest is recorded as a pass that the host earned at the entry's scope. It is
 * keyed on this machine's inputs and the host's command string, so that an entry whose string differs from what would
 * run here is never recalled, and its excerpts are keyed on this invocation's presentation, for which the host styled
 * them. The invocation's own entry supplies only the retention of the invocation's pass, which is recorded last, so
 * that a reader never sees a composite's pass ahead of its constituents' passes.
 */
export async function recordDelegatedPass(
  plan: RunPlan,
  gate: Gate,
  hostRun: Extract<HostRunResult, { kind: 'ran' }>,
): Promise<void> {
  const { anchorDir, command, context, env, stderr } = plan.invocation;
  const { config, monorepoRoot } = context;

  if (hostRun.treeId !== gate.snapshot.treeId) {
    writeDebugNote(`not recording ${command}: the pushed tree is not the tree that the gate keyed on`, env, stderr);
    return;
  }

  // Hashed afresh rather than inherited: an inherited snapshot is the observation that this is meant to re-test.
  const currentRead = resolveTreeSnapshot({ monorepoRoot, env: {} });
  if (!currentRead.ok) {
    writeDebugNote(`not recording ${command}: ${currentRead.reason}`, env, stderr);
    return;
  }
  if (currentRead.snapshot.treeId !== gate.snapshot.treeId) {
    writeDebugNote(`not recording ${command}: the tree changed while it ran`, env, stderr);
    return;
  }

  const entries = validatePassManifest({
    checkCache: config.checkCache,
    entries: hostRun.passes,
    env,
    monorepoRoot,
    stderr,
    treeId: gate.snapshot.treeId,
    workspacePackageDirs: context.workspacePackageDirs,
  });
  const ownScope = formatManifestScope(monorepoRoot, anchorDir);
  let ownReplay: ReplayLine[] | undefined;
  for (const entry of entries) {
    if (entry.scope === ownScope && entry.command === command) {
      if (entry.commandString === plan.commandString) {
        ownReplay = entry.replay;
      }
      continue;
    }
    await recordLearnedPass(plan, gate, hostRun.host, entry);
  }

  await recordHostPass({
    commandString: plan.commandString,
    config,
    durationMs: hostRun.durationMs,
    env,
    host: hostRun.host,
    key: gate.key,
    monorepoRoot,
    ref: { anchorDir, command, monorepoRoot },
    retainedOutput: hostRun.retainedOutput,
    retention: composeRetention(gate.retentionKey, ownReplay, plan.runId),
    snapshot: gate.snapshot,
    stderr,
  });
}

// region | Helpers

/** Returns the retention that a learned pass records, or `undefined` when the host reported nothing to replay. */
function composeRetention(key: string, replay: ReplayLine[] | undefined, runId: string): Retention | undefined {
  return replay === undefined ? undefined : { key, replay, runId };
}

/**
 * Records a pass that the host reported at another scope or for another command, without a transcript: the stream
 * that this machine retained is the invocation's own.
 */
async function recordLearnedPass(plan: RunPlan, gate: Gate, host: string, entry: PassManifestEntry): Promise<void> {
  const { context, env, stderr } = plan.invocation;
  const { monorepoRoot } = context;
  const anchorDir = path.resolve(monorepoRoot, entry.scope);

  const keyed = computeCacheKey({
    anchorDir,
    command: entry.command,
    commandString: entry.commandString,
    env,
    monorepoRoot,
    nmrVersion: VERSION,
    snapshot: gate.snapshot,
  });
  if (!keyed.ok) {
    writeDebugNote(`not recording ${entry.command} on ${host}: ${keyed.reason}`, env, stderr);
    return;
  }

  await recordHostPass({
    commandString: entry.commandString,
    config: context.config,
    durationMs: entry.durationMs,
    env,
    host,
    key: keyed.key,
    monorepoRoot,
    ref: { anchorDir, command: entry.command, monorepoRoot },
    retainedOutput: undefined,
    retention: composeRetention(
      computeRetentionKey({ channels: gate.channels, env, passKey: keyed.key }),
      entry.replay,
      plan.runId,
    ),
    snapshot: gate.snapshot,
    stderr,
  });
}

// endregion | Helpers
