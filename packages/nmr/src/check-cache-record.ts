import path from 'node:path';
import type { Writable } from 'node:stream';

import { describeError } from '@williamthorsen/toolbelt.errors';

import { isCacheableCommand, resolveTreeSnapshot, type TreeSnapshot, writeDebugNote } from './check-cache.ts';
import { type BuildOutputState, findStaleBuildOutput, readBuildOutputState } from './check-cache-build-output.ts';
import {
  type CheckCacheEntry,
  type EntryRef,
  readCheckCacheEntry,
  recordTranscript,
  type Retention,
  writeCheckCacheEntry,
} from './check-cache-entries.ts';
import { CURRENT_RUNTIME } from './check-cache-key.ts';
import { deriveExcerpt } from './helpers/deriveExcerpt.ts';
import { composeTranscript } from './helpers/transcript.ts';
import { RUN_IF_PRESENT_ENV_VAR, type RunCliResult, type RunPlan, VERSION } from './invocation.ts';
import { renderRecording, renderRefusal, resolveRecording } from './recording.ts';
import { assembleReplay } from './replay-assembly.ts';
import type { RetainedOutput } from './runner.ts';
import type { Step } from './steps.ts';
import type { NmrConfig } from './types.ts';

/**
 * Records a pass, unless what the check was asked about moved while it ran: a rewritten file describes a tree
 * that no longer exists, and build output that changed leaves it unclear over which output the pass was earned.
 * Recording either would certify content against which nothing ran. The recorded key is the one that the
 * snapshot produced, so every entry from one invocation refers to one tree.
 *
 * A cache that cannot be written is not worth failing a green run over: `recordPass` reports that failure in the
 * debug note.
 *
 * The retention that a skip replays is composed here for the same reason and after the same tests: a pass that is
 * not recorded must not leave behind an excerpt that claims it was. A composite's assembly is built here rather
 * than when it skips, to ensure that every excerpt in it was certified during the run whose pass contains it.
 *
 * A pass earned on a host is recorded with that host and without build digests or retention: this machine's build
 * output says nothing about the host's, and replaying a delegated run is not supported. It does not replace a pass
 * earned here under the same key, which already satisfies every invocation that the host pass would.
 */
export async function recordPass(options: {
  anchorDir: string;
  buildOutputBefore: BuildOutputState;
  command: string;
  commandString: string;
  config: NmrConfig;
  durationMs: number;
  env: NodeJS.ProcessEnv;
  host?: string;
  key: string;
  monorepoRoot: string;
  retainedOutput: RetainedOutput | undefined;
  ownSteps: readonly Step[];
  retentionKey: string;
  runId: string;
  snapshot: TreeSnapshot;
  stderr: Writable;
}): Promise<void> {
  const { anchorDir, command, env, host, monorepoRoot, snapshot, stderr } = options;

  // Hashed afresh rather than inherited: an inherited snapshot is the observation that this is meant to re-test.
  const currentRead = resolveTreeSnapshot({ monorepoRoot, env: {} });
  if (!currentRead.ok) {
    writeDebugNote(`not recording ${command}: ${currentRead.reason}`, env, stderr);
    return;
  }
  if (currentRead.snapshot.treeId !== snapshot.treeId) {
    writeDebugNote(`not recording ${command}: the tree changed while it ran`, env, stderr);
    return;
  }

  const ref = { anchorDir, command, monorepoRoot };
  if (host !== undefined) {
    await recordHostPass({ ...options, host, ref });
    return;
  }

  // Read after the chain, so that the digests describe the output over which the pass was actually earned.
  // Because a pass over a repository that is still missing output describes a state to which later runs should
  // not be held, it is not recorded.
  const output = await readBuildOutputState(monorepoRoot, options.config);
  const [missingPackage] = output.missingPackages;
  if (missingPackage !== undefined) {
    writeDebugNote(`not recording ${command}: ${missingPackage} does not have build output`, env, stderr);
    return;
  }

  // The check read one output and the entry would record the other: neither describes the pass. A chain that
  // builds its own covered output disagrees with itself here and declines for the same reason.
  const changedPackage = findStaleBuildOutput(options.buildOutputBefore.digests, output.digests);
  if (changedPackage !== undefined) {
    writeDebugNote(`not recording ${command}: ${changedPackage}'s build output changed while it ran`, env, stderr);
    return;
  }

  const retention = await composeRetention({
    anchorDir,
    command,
    key: options.retentionKey,
    monorepoRoot,
    retainedOutput: options.retainedOutput,
    runId: options.runId,
    steps: options.ownSteps,
    treeHash: snapshot.treeId,
  });

  await writePass({
    entry: {
      key: options.key,
      treeHash: snapshot.treeId,
      headSha: snapshot.headSha,
      commandString: options.commandString,
      nmrVersion: VERSION,
      nodeVersion: CURRENT_RUNTIME.nodeVersion,
      durationMs: options.durationMs,
      recordedAt: new Date().toISOString(),
      buildDigests: output.digests,
      ...(retention !== undefined && { retention }),
    },
    env,
    ref,
    retainedOutput: options.retainedOutput,
    stderr,
  });
}

/**
 * Prints what the current scope has recorded for one command, and reports what it exits with.
 *
 * A refusal ends the invocation non-zero, which is what tells a caller that nothing on stdout is the run that it
 * asked for. Under a delegate it does not: a fan-out asks every selected scope, and a scope that never ran the
 * command is a gap in a survey rather than a failure of one, so bailing there would hide every scope that has
 * something to show.
 */
export async function reportRecording(plan: RunPlan): Promise<RunCliResult> {
  const { anchorDir, command, context, env, scope, stderr, stdout, styles } = plan.invocation;
  const { config, monorepoRoot } = context;

  const lookup = await resolveRecording({
    anchorDir,
    command,
    currentIdentity: {
      commandString: plan.commandString,
      nmrVersion: VERSION,
      nodeVersion: CURRENT_RUNTIME.nodeVersion,
      treeHash: plan.snapshot?.treeId,
    },
    isCacheable: isCacheableCommand(config.checkCache, command),
    key: plan.key,
    monorepoRoot,
  });

  if (!lookup.ok) {
    stderr.write(`${renderRefusal({ command, refusal: lookup.refusal, scope, style: styles.stderr })}\n`);
    return { exitCode: env[RUN_IF_PRESENT_ENV_VAR] === '1' ? 0 : 1 };
  }

  stdout.write(renderRecording({ command, recording: lookup.recording, scope, style: styles.stdout }));

  return { exitCode: 0 };
}

// region | Helpers

/**
 * Composes the retention that a pass records, or `undefined` when the run left nothing to replay: a command whose
 * streams were handed to a terminal did not retain a copy, one that printed nothing does not yield an excerpt,
 * and a composite whose constituents recorded none has nothing to assemble.
 *
 * A leaf hands back what its own command wrote. The excerpt comes from stdout, where every command that the gate
 * covers writes its substance, and falls back to stderr only when stdout does not yield an excerpt. A composite hands
 * back nothing of its own -- `expandScript` gives a step list that is either one opaque step or all structural
 * ones -- so its retention is the assembly of what its constituents recorded.
 */
async function composeRetention(options: {
  anchorDir: string;
  command: string;
  key: string;
  monorepoRoot: string;
  retainedOutput: RetainedOutput | undefined;
  runId: string;
  steps: readonly Step[];
  treeHash: string;
}): Promise<Retention | undefined> {
  const { anchorDir, command, key, retainedOutput, runId } = options;

  if (retainedOutput !== undefined) {
    const excerpt =
      deriveExcerpt(retainedOutput.stdout.toString('utf8')) ?? deriveExcerpt(retainedOutput.stderr.toString('utf8'));
    if (excerpt === undefined) {
      return undefined;
    }

    return { key, replay: [{ command, excerpt, scope: path.basename(anchorDir) }], runId };
  }

  const replay = await assembleReplay({
    anchorDir,
    monorepoRoot: options.monorepoRoot,
    runId,
    steps: options.steps,
    treeHash: options.treeHash,
  });

  return replay.length === 0 ? undefined : { key, replay, runId };
}

/** Records a pass that `host` earned, unless a pass earned here is already recorded under the same key. */
async function recordHostPass(options: {
  commandString: string;
  durationMs: number;
  env: NodeJS.ProcessEnv;
  host: string;
  key: string;
  ref: EntryRef;
  retainedOutput: RetainedOutput | undefined;
  snapshot: TreeSnapshot;
  stderr: Writable;
}): Promise<void> {
  const { env, host, key, ref, snapshot, stderr } = options;

  const recorded = await readCheckCacheEntry(ref);
  if (recorded !== undefined && recorded.host === undefined && recorded.key === key) {
    writeDebugNote(`not recording ${ref.command} on ${host}: a pass earned here covers this tree`, env, stderr);
    return;
  }

  await writePass({
    entry: {
      key,
      treeHash: snapshot.treeId,
      headSha: snapshot.headSha,
      commandString: options.commandString,
      nmrVersion: VERSION,
      nodeVersion: CURRENT_RUNTIME.nodeVersion,
      durationMs: options.durationMs,
      recordedAt: new Date().toISOString(),
      buildDigests: {},
      host,
    },
    env,
    ref,
    retainedOutput: options.retainedOutput,
    stderr,
  });
}

/** Writes an entry and the transcript beside it, withdrawing the transcript when the entry cannot be written. */
async function writePass(options: {
  entry: CheckCacheEntry;
  env: NodeJS.ProcessEnv;
  ref: EntryRef;
  retainedOutput: RetainedOutput | undefined;
  stderr: Writable;
}): Promise<void> {
  const { entry, env, ref, stderr } = options;
  const transcript = options.retainedOutput === undefined ? undefined : composeTranscript(options.retainedOutput);

  try {
    // Record the transcript ahead of the entry, so that a reader never dates one run's bytes by another run's
    // instant.
    await recordTranscript(ref, transcript);
    await writeCheckCacheEntry({ ...ref, entry });
  } catch (error: unknown) {
    try {
      await recordTranscript(ref, undefined);
    } catch {
      // Ignore this failure: the caller needs to hear about the entry's own.
    }
    writeDebugNote(`could not record ${ref.command}: ${describeError(error)}`, env, stderr);
  }
}

// endregion | Helpers
