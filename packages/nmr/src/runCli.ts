import type { Writable } from 'node:stream';

import { reportError } from '@williamthorsen/nmr-core';
import { runCli as runRouter } from '@williamthorsen/nmr-core/cli';

import { prependBinDirs } from './bin-path.ts';
import { NMR_BIN } from './bins.ts';
import { NO_CACHE_ENV_VAR, resolveRunId, RUN_ID_ENV_VAR } from './check-cache/check-cache.ts';
import { openGate, runGated } from './check-cache/check-cache-gate.ts';
import { reportRecording } from './check-cache/check-cache-record.ts';
import { addLockEnv, buildChildEnv, takeMachineLock } from './child-env.ts';
import { resolveContext } from './context.ts';
import { assertNoSelfReference } from './crossing-diagnostics.ts';
import { resolveExecutionTarget, runInvocationOnHost } from './delegation/delegate-host.ts';
import { DELEGATE_TO_FLAG } from './delegation/remote-run.ts';
import { enterChain } from './entry-chain.ts';
import { composeDelegation, runDelegation } from './fan-out.ts';
import {
  type ReadFilterSelection,
  readFilterSelection as readFilterSelectionDefault,
} from './helpers/filter-selection.ts';
import {
  type ExecutionTarget,
  type Invocation,
  type PhaseResult,
  RUN_IF_PRESENT_ENV_VAR,
  type RunCliResult,
  type RunPlan,
  type SettledResult,
  USAGE_EXIT_CODE,
  VERSION,
} from './invocation.ts';
import { formatMisplacedFlagHint } from './invocation-args.ts';
import { readInvocationFlags } from './nmr-flags.ts';
import { reportVerdict } from './presentation.ts';
import { buildRootRegistry, buildWorkspaceRegistry, resolveScript } from './resolver.ts';
import { buildRoot, buildVersionRoot } from './route.ts';
import { assembleChain, formatOverrideNotice } from './run-chain.ts';
import { type RunSteps, runSteps as runStepsDefault, type RunStepsOptions } from './runner.ts';

/** @internal */
export interface RunCliOptions {
  /** Post-slice CLI arguments (equivalent to `process.argv.slice(2)`). */
  args: string[];
  /** Working directory used to resolve the nmr execution context. */
  cwd: string;
  /** Environment from which `runCli` reads its settings, and the base of the one that its children inherit. */
  env: NodeJS.ProcessEnv;
  /** Reads what a `-F` pattern selects; defaults to `readFilterSelection`, which asks pnpm. */
  readFilterSelection?: ReadFilterSelection;
  /** Runs a step list; defaults to `runSteps`. */
  runSteps?: RunSteps;
  /** Stream for normal output: help, version, verdicts, recordings, and override notices. */
  stdout: Writable;
  /** Stream for errors, warnings, and debug notes. */
  stderr: Writable;
}

/**
 * Executes the nmr CLI flow in-process and returns the resulting exit code.
 * Does not hold global state, does not read `process.*` globals, and never calls `process.exit`.
 *
 * nmr's flags decide which commands the tree holds, so a first pass reads them before the router parses them again.
 *
 * @internal
 */
export async function runCli(options: RunCliOptions): Promise<RunCliResult> {
  const {
    args,
    cwd,
    env,
    readFilterSelection = readFilterSelectionDefault,
    runSteps = runStepsDefault,
    stdout,
    stderr,
  } = options;
  const reading = readInvocationFlags(args);
  const firstPass = reading.ok ? reading.parsedArgs : undefined;
  const routerOptions = { name: NMR_BIN, context: undefined, stdout, stderr, baseDir: cwd, version: () => VERSION };

  // `--version` does not load the config, so that it answers outside a monorepo as well.
  if (firstPass?.shouldShowVersion === true && !firstPass.shouldShowHelp) {
    return { exitCode: await runRouter(args, buildVersionRoot(), routerOptions) };
  }

  const context = await resolveContext(cwd);
  const root = buildRoot({
    context,
    cwd,
    env,
    firstPass,
    readFilterSelection,
    runInvocation: (invocation) => runInvocation(invocation, options),
    runSteps,
    stderr,
    stdout,
  });

  // An invocation that names nothing to run is a request for the listing.
  const isBare =
    firstPass !== undefined && firstPass.command === undefined && !firstPass.shouldPrintLog && !args.includes('--');
  const routedArgs = isBare ? [...args, '--help'] : args;

  return { exitCode: await runRouter(routedArgs, root, routerOptions) };
}

/**
 * Runs an invocation that reached a command, and hints at nmr flags written after the command name when it fails.
 */
async function runInvocation(invocation: Invocation, options: RunCliOptions): Promise<number> {
  const resolvedTarget = await resolveExecutionTarget(invocation);
  if (resolvedTarget.settled) {
    return resolvedTarget.result.exitCode;
  }
  let target = resolvedTarget.value;

  // A fan-out does not have a gate of its own to consult, so the host receives it whole and fans it out there.
  const { filter, recursive } = invocation.parsedArgs;
  if (target.kind === 'remote' && (filter !== undefined || recursive)) {
    const delegated = await runInvocationOnHost(invocation, target);
    if (delegated !== undefined) {
      return delegated.exitCode;
    }
    target = { kind: 'local' };
  }

  const planned = await planRun(invocation, target);
  const { exitCode, isUnknownCommand = false } = planned.settled ? planned.result : await executePlan(planned.value);

  // A process that nmr started did not receive its arguments from the user, and its parent reports the hint once.
  if (exitCode !== 0 && !isUnknownCommand && isTopLevelInvocation(options.env)) {
    const hint = formatMisplacedFlagHint(options.args, invocation.parsedArgs.passthrough, invocation.styles.stderr);
    if (hint !== undefined) {
      options.stderr.write(`${hint}\n`);
    }
  }

  return exitCode;
}

/**
 * Determines what an invocation would run, and settles every invocation that does not run its command: a
 * fan-out, an unknown command, a no-op override, and an argument that no step can take. A delegated invocation is
 * planned here as well, so that it settles without contacting the host and its gate is consulted before the host is.
 */
async function planRun(invocation: Invocation, target: ExecutionTarget): Promise<PhaseResult<RunPlan>> {
  const { anchorDir, command, context, env, parsedArgs, stderr, stdout, styles } = invocation;
  const quiet = invocation.verbosity === 'quiet';

  const snapshot = openGate({
    command,
    config: context.config,
    env,
    monorepoRoot: context.monorepoRoot,
    passthrough: parsedArgs.passthrough,
    stderr,
    style: styles.stderr,
  });

  const shouldBypassCache = parsedArgs.shouldBypassCache || env[NO_CACHE_ENV_VAR] === '1';
  const runId = resolveRunId(env);
  const childEnv = buildChildEnv({
    env,
    format: invocation.format,
    shouldBypassCache,
    shouldBypassLock: parsedArgs.shouldBypassLock,
    passthrough: parsedArgs.passthrough,
    runId,
    snapshot,
    styles,
    verbosity: invocation.verbosity,
  });
  const runOptions: RunStepsOptions = {
    bin: NMR_BIN,
    quiet,
    stdout,
    stderr,
    env: childEnv,
  };

  // -F and -R: delegate to pnpm, which runs one nmr per scope that it selects
  const delegation = composeDelegation({ childEnv, command, parsedArgs });
  if (delegation !== undefined) {
    // The delegating process holds the lock for the whole fan-out, so that the scopes that pnpm runs in parallel
    // do not wait on one another.
    const lock = await takeMachineLock(invocation);
    let result: RunCliResult;
    try {
      const heldDelegation = { ...delegation, env: addLockEnv(delegation.env, lock) };
      result = await runDelegation({
        context,
        delegation: heldDelegation,
        parsedArgs,
        readFilterSelection: invocation.readFilterSelection,
        runOptions,
        runSteps: invocation.runSteps,
        stderr,
      });
    } finally {
      await lock?.release();
    }

    return { settled: true, result };
  }

  const registry = invocation.shouldUseRoot
    ? buildRootRegistry(context.config, context.monorepoRoot)
    : buildWorkspaceRegistry(context.config);

  assertNoSelfReference({
    anchorDir,
    command,
    isReading: parsedArgs.shouldPrintLog,
    isWorkspaceRoot: parsedArgs.isWorkspaceRoot,
    monorepoRoot: context.monorepoRoot,
    registry,
  });

  const resolvedScript = resolveScript(command, registry, anchorDir, parsedArgs.isWorkspaceRoot);

  if (!resolvedScript) {
    if (env[RUN_IF_PRESENT_ENV_VAR] === '1') {
      return { settled: true, result: { exitCode: 0 } };
    }
    // A host name after bare `--delegate` reads as the command, and it belongs to `--delegate-to`.
    const delegateToHint =
      parsedArgs.shouldDelegate && parsedArgs.delegateHosts === undefined
        ? `. \`${command}\` is not a command; name a host with ${DELEGATE_TO_FLAG} ${command}`
        : '';
    reportError(NMR_BIN, `Unknown command: ${command}${delegateToHint}`, stderr);
    return { settled: true, result: { exitCode: USAGE_EXIT_CODE, isUnknownCommand: true } };
  }

  // A `--log` runs nothing, so it cannot re-enter anything.
  const entryRunOptions: RunStepsOptions = parsedArgs.shouldPrintLog
    ? runOptions
    : {
        ...runOptions,
        env: enterChain({
          anchorDir,
          command,
          env: prependBinDirs({ anchorDir, env: childEnv, monorepoRoot: context.monorepoRoot }),
          monorepoRoot: context.monorepoRoot,
        }),
      };

  const chain = assembleChain({ invocation, registry, resolvedScript, snapshot });
  if (chain.settled) {
    return chain;
  }

  return {
    settled: false,
    value: {
      ...chain.value,
      invocation,
      overrideNotice: formatOverrideNotice(resolvedScript, registry, command, anchorDir, quiet, styles.stdout),
      runId,
      runOptions: entryRunOptions,
      shouldBypassCache,
      snapshot,
      target,
    },
  };
}

/** Runs a plan behind the check-result cache and reports its verdict, or prints its recording under `--log`. */
async function executePlan(plan: RunPlan): Promise<SettledResult> {
  const { command, format, parsedArgs, scope, stdout, styles } = plan.invocation;

  // A `--log` needs the key for the whole chain, and returns before any hook, verdict, or cache write.
  if (parsedArgs.shouldPrintLog) {
    return reportRecording(plan);
  }

  const { exitCode, host, outcome } = await runGated(plan);

  if (outcome !== undefined) {
    reportVerdict({ command, ...(host !== undefined && { host }), scope, ...outcome }, stdout, format, styles.stdout);
  }

  return { exitCode };
}

// region | Helpers

/** Reports whether the user typed this invocation, rather than an nmr process starting it. */
function isTopLevelInvocation(env: NodeJS.ProcessEnv): boolean {
  const runId = env[RUN_ID_ENV_VAR];

  return runId === undefined || runId === '';
}

// endregion | Helpers
