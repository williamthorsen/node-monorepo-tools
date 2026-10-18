import type { Writable } from 'node:stream';

import type { OutputStyle } from '@williamthorsen/nmr-core';

import {
  formatMisplacedNoCacheWarning,
  isCacheableCommand,
  resolveTreeSnapshot,
  type TreeSnapshot,
  writeDebugNote,
} from './check-cache.ts';
import { type BuildOutputState, findStaleBuildOutput, readBuildOutputState } from './check-cache-build-output.ts';
import { type Gate, recordDelegatedPass } from './check-cache-delegation.ts';
import { certifyRetention, type CheckCacheEntry, readCheckCacheEntry, type ReplayLine } from './check-cache-entries.ts';
import { computeCacheKey, computeRetentionKey } from './check-cache-key.ts';
import { recordPass } from './check-cache-record.ts';
import { addLockEnv, takeMachineLock } from './child-env.ts';
import { runPlanOnHost } from './delegate-host.ts';
import { type RunPlan, VERSION } from './invocation.ts';
import { resolveChannel } from './output-channel.ts';
import { writePassManifestEntry } from './pass-manifest.ts';
import { runSteps } from './runner.ts';
import type { NmrConfig } from './types.ts';
import type { VerdictOutcome } from './verdict.ts';

/**
 * Decides whether the check-result cache covers this invocation, and takes the tree snapshot on which it would
 * gate.
 * Returns `undefined` when the cache does not apply, which always means the command runs.
 *
 * Decided before anything is resolved or spawned, so that a delegating invocation hands the snapshot to its
 * children rather than leaving each of them to hash the tree again. A hook leaf is out of scope because it is
 * not a command that anyone asks for: it runs as part of the chain that the gate already covers. Arguments are
 * out of scope because they change what a command does in ways that the gate cannot read.
 */
export function openGate(options: {
  command: string;
  config: NmrConfig;
  env: NodeJS.ProcessEnv;
  monorepoRoot: string;
  passthrough: string[];
  stderr: Writable;
  style: OutputStyle;
}): TreeSnapshot | undefined {
  const { command, config, env, monorepoRoot, passthrough, stderr, style } = options;

  if (!isCacheableCommand(config.checkCache, command)) {
    return undefined;
  }

  // A `--no-cache` past the command name is an argument to that command, and is passed on as one. Without this
  // warning, the developer would believe that the bypass happened.
  if (passthrough.includes('--no-cache')) {
    stderr.write(`${formatMisplacedNoCacheWarning(command, style)}\n`);
  }
  if (passthrough.length > 0) {
    writeDebugNote(`gate disabled: ${command} was passed arguments`, env, stderr);
    return undefined;
  }

  const snapshot = resolveTreeSnapshot({ monorepoRoot, env });
  if (!snapshot.ok) {
    writeDebugNote(`gate disabled: ${snapshot.reason}`, env, stderr);
    return undefined;
  }

  return snapshot.snapshot;
}

/**
 * Computes the key under which this invocation would be recorded, or `undefined` when the cache does not apply.
 * The cache does not apply to a `devBin` substitution: the substitute is built from a location that the tree id
 * does not describe, so a pass by it is not a pass by the command that the key names.
 */
export function resolveCacheKey(options: {
  anchorDir: string;
  command: string;
  commandString: string;
  env: NodeJS.ProcessEnv;
  monorepoRoot: string;
  snapshot: TreeSnapshot | undefined;
  stderr: Writable;
  substitution: string | undefined;
}): string | undefined {
  const { env, snapshot, stderr, substitution } = options;
  if (snapshot === undefined) {
    return undefined;
  }
  if (substitution !== undefined) {
    writeDebugNote(`gate disabled: devBin substituted \`${substitution}\``, env, stderr);
    return undefined;
  }

  const result = computeCacheKey({
    anchorDir: options.anchorDir,
    command: options.command,
    commandString: options.commandString,
    env,
    monorepoRoot: options.monorepoRoot,
    nmrVersion: VERSION,
    snapshot,
  });
  if (!result.ok) {
    writeDebugNote(`gate disabled: ${result.reason}`, env, stderr);
    return undefined;
  }

  return result.key;
}

/**
 * Runs the resolved steps behind the check-result cache: skips them when a recorded pass covers this
 * invocation, and records a pass when one is earned. Returns the exit code and the outcome that a verdict reports,
 * either way, with the host that earned the outcome when it was not this machine. The outcome is absent when the
 * invocation already reported why it did not run.
 *
 * The cache is consulted before the plan's target is: a miss runs on the host to which the invocation is delegated,
 * outside this machine's lock, and runs here only when there is not a host to run on.
 *
 * The override notice waits until the command is going to run, because naming the script that stands in for a
 * built-in says nothing useful about an invocation that skipped it.
 *
 * Two step lists: `steps` is the chain that runs, the hooks wrapped around the command included, and
 * `ownSteps` is the command's alone, which is what a composite's assembly reads. A hook contributes nothing to
 * what a skip replays, as it contributes nothing to a leaf's excerpt.
 */
export async function runGated(plan: RunPlan): Promise<GatedResult> {
  const { commandString, key } = plan;
  const { anchorDir, command, context, env, stderr, stdout } = plan.invocation;
  const { config, monorepoRoot } = context;

  let gate = await readGate(plan);

  if (gate !== undefined && !plan.shouldBypassCache) {
    const recalled = await recallPass(plan, gate);
    if (recalled !== undefined) {
      return recalled;
    }
  }

  const hostResult = await runOnHost(plan, gate);
  if (hostResult !== undefined) {
    return hostResult;
  }

  const lock = await takeMachineLock(plan.invocation);
  try {
    // The holder that this run waited on may have recorded a pass for this tree, or rebuilt the output that a pass
    // is held to, so the gate is read again.
    if (lock?.waited === true && key !== undefined) {
      gate = await readGate(plan);
      if (gate !== undefined && !plan.shouldBypassCache) {
        const recalled = await recallPass(plan, gate);
        if (recalled !== undefined) {
          return recalled;
        }
      }
    }

    if (plan.overrideNotice !== undefined) {
      stdout.write(plan.overrideNotice);
    }

    const runOptions = { ...plan.runOptions, env: addLockEnv(plan.runOptions.env ?? env, lock) };
    const startedAtMs = Date.now();
    const { exitCode, retainedOutput } = await runSteps(plan.steps, anchorDir, runOptions);
    const durationMs = Date.now() - startedAtMs;

    if (exitCode === 0 && gate !== undefined) {
      await recordPass({
        anchorDir,
        buildOutputBefore: gate.buildOutputBefore,
        command,
        commandString,
        config,
        durationMs,
        env,
        key: gate.key,
        monorepoRoot,
        ownSteps: plan.ownSteps,
        retainedOutput,
        retentionKey: gate.retentionKey,
        runId: plan.runId,
        snapshot: gate.snapshot,
        stderr,
      });
    }

    return {
      exitCode,
      outcome: exitCode === 0 ? { outcome: 'passed', durationMs } : { outcome: 'failed', durationMs, exitCode },
    };
  } finally {
    await lock?.release();
  }
}

// region | Helpers

/** How a gated invocation ended, and the host that ran it when it was not this machine. */
interface GatedResult {
  exitCode: number;
  host?: string;
  outcome?: VerdictOutcome;
}

/** Returns what a recalled entry reports, with the excerpts only when they describe this environment's output. */
function composeRecall(
  entry: CheckCacheEntry,
  retentionKey: string,
): { ageMs: number; entry: CheckCacheEntry; replay?: ReplayLine[]; savedMs: number } {
  return {
    ageMs: Math.max(0, Date.now() - Date.parse(entry.recordedAt)),
    entry,
    savedMs: entry.durationMs,
    ...(entry.retention?.key === retentionKey && { replay: entry.retention.replay }),
  };
}

/**
 * Returns the age and saving that a recalled pass reports when a recorded pass covers this invocation, or
 * `undefined` when the command has to run. A key match alone is not a pass: the build output about which the key
 * says nothing has to still be on disk, and the run that follows a missing-output miss restores it.
 *
 * The excerpts that a skip replays come back only when the retention key matches too. A recording made under
 * another presentation environment is still a pass, and is not this environment's output.
 *
 * The entry comes back with them, so that the caller can certify what it is about to replay.
 *
 * A pass earned here satisfies every invocation; one earned on a host satisfies only a delegation that lists that
 * host, and is not held to this machine's build output, which says nothing about the host's.
 */
async function lookUpRecordedPass(options: {
  anchorDir: string;
  buildOutput: BuildOutputState;
  command: string;
  env: NodeJS.ProcessEnv;
  key: string;
  monorepoRoot: string;
  retentionKey: string;
  stderr: Writable;
  targetHosts: readonly string[] | undefined;
}): Promise<{ ageMs: number; entry: CheckCacheEntry; replay?: ReplayLine[]; savedMs: number } | undefined> {
  const { anchorDir, buildOutput, command, env, key, monorepoRoot, stderr, targetHosts } = options;

  const entry = await readCheckCacheEntry({ anchorDir, command, monorepoRoot });
  if (entry === undefined) {
    writeDebugNote(`running ${command}: no pass recorded for this scope`, env, stderr);
    return undefined;
  }
  if (entry.key !== key) {
    writeDebugNote(`running ${command}: the tree or its inputs changed since the last pass`, env, stderr);
    return undefined;
  }
  if (entry.host !== undefined) {
    if (targetHosts?.includes(entry.host) !== true) {
      writeDebugNote(`running ${command}: the last pass was earned on ${entry.host}`, env, stderr);
      return undefined;
    }

    return composeRecall(entry, options.retentionKey);
  }

  const [missingPackage] = buildOutput.missingPackages;
  if (missingPackage !== undefined) {
    writeDebugNote(`running ${command}: ${missingPackage} does not have build output`, env, stderr);
    return undefined;
  }

  // Presence alone would let a `dist` compiled from another tree pass for this one: git ignores build output,
  // so restoring a tree restores none of it, and the run that would have rebuilt it is the one being skipped.
  const stalePackage = findStaleBuildOutput(entry.buildDigests, buildOutput.digests);
  if (stalePackage !== undefined) {
    writeDebugNote(`running ${command}: ${stalePackage}'s build output came from a different tree`, env, stderr);
    return undefined;
  }

  return composeRecall(entry, options.retentionKey);
}

/**
 * Reads what the check-result cache gates on, or returns `undefined` when the cache does not cover the plan.
 *
 * The build output is read before the run, so that a pass can be held to the output that the run actually saw. One
 * reading serves the lookup and the recording alike, and `--no-cache` bypasses only the former. The channels are
 * read from the same `resolveChannel` that the runner calls, to keep the retention key and the run from disagreeing
 * about what the child saw.
 */
async function readGate(plan: RunPlan): Promise<Gate | undefined> {
  const { key, snapshot } = plan;
  const { context, env, stderr, stdout } = plan.invocation;
  if (key === undefined || snapshot === undefined) {
    return undefined;
  }

  const quiet = plan.runOptions.quiet === true;
  const channels = { stderr: resolveChannel(stderr, quiet), stdout: resolveChannel(stdout, quiet) };

  return {
    buildOutputBefore: await readBuildOutputState(context.monorepoRoot, context.config),
    channels,
    key,
    retentionKey: computeRetentionKey({ channels, env, passKey: key }),
    snapshot,
  };
}

/** Returns the outcome of a recorded pass that covers the plan, or `undefined` when none does. */
async function recallPass(plan: RunPlan, gate: Gate): Promise<GatedResult | undefined> {
  const { anchorDir, command, context, env, stderr } = plan.invocation;
  const { monorepoRoot } = context;

  const recalledPass = await lookUpRecordedPass({
    anchorDir,
    buildOutput: gate.buildOutputBefore,
    command,
    env,
    key: gate.key,
    monorepoRoot,
    retentionKey: gate.retentionKey,
    stderr,
    targetHosts: plan.target.kind === 'remote' ? plan.target.hosts : undefined,
  });
  if (recalledPass === undefined) {
    return undefined;
  }

  const { entry, ...recall } = recalledPass;
  // An excerpt that this run declined to replay is one that it has not certified, and vouching for it here would
  // put another environment's output into the assembly that a composite above this one records.
  if (recall.replay !== undefined) {
    await certifyRetention({ anchorDir, command, entry, env, monorepoRoot, runId: plan.runId, stderr });
  }
  // A pass that a host earned is not this run's work, so the run does not report it to the machine that delegated it.
  if (entry.host === undefined) {
    await writePassManifestEntry({
      anchorDir,
      command,
      commandString: plan.commandString,
      durationMs: entry.durationMs,
      env,
      monorepoRoot,
      replay: recall.replay,
      stderr,
      treeHash: gate.snapshot.treeId,
    });
  }

  return {
    exitCode: 0,
    ...(entry.host !== undefined && { host: entry.host }),
    outcome: { outcome: 'recalled', ...recall },
  };
}

/**
 * Runs a delegated plan on its host and records the pass that the host earns. Returns `undefined` when the plan is
 * not delegated, or when its tree cannot be delegated and it runs here instead.
 */
async function runOnHost(plan: RunPlan, gate: Gate | undefined): Promise<GatedResult | undefined> {
  if (plan.target.kind !== 'remote') {
    return undefined;
  }

  const hostRun = await runPlanOnHost(plan, plan.target);
  if (hostRun.kind === 'here') {
    return undefined;
  }
  if (hostRun.kind === 'refused') {
    return { exitCode: hostRun.exitCode };
  }
  if (hostRun.exitCode === 0 && gate !== undefined) {
    await recordDelegatedPass(plan, gate, hostRun);
  }

  return { exitCode: hostRun.exitCode, host: hostRun.host, outcome: hostRun.outcome };
}

// endregion | Helpers
