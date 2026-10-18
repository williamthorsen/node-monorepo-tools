import path from 'node:path';
import type { Writable } from 'node:stream';

import { reportError } from '@williamthorsen/nmr-core';

import { prependBinDirs } from './bin-path.ts';
import { NO_CACHE_ENV_VAR, resolveRunId, RUN_ID_ENV_VAR } from './check-cache.ts';
import { openGate, runGated } from './check-cache-gate.ts';
import { reportRecording } from './check-cache-record.ts';
import { addLockEnv, buildChildEnv, takeMachineLock } from './child-env.ts';
import { resolveContext } from './context.ts';
import { assertNoSelfReference } from './crossing-diagnostics.ts';
import { resolveExecutionTarget, runInvocationOnHost } from './delegate-host.ts';
import { enterChain } from './entry-chain.ts';
import { composeDelegation, isDefinedInAnyScope, runDelegation } from './fan-out.ts';
import { generateHelp } from './help.ts';
import {
  type ExecutionTarget,
  type Invocation,
  type PhaseResult,
  RUN_IF_PRESENT_ENV_VAR,
  type RunCliResult,
  type RunPlan,
  type SettledResult,
  VERSION,
} from './invocation.ts';
import { formatMisplacedFlagHint, parseArgs } from './invocation-args.ts';
import { isTerminalStream } from './output-style.ts';
import { readPresentation, reportVerdict, resolveReportingVerbosity } from './presentation.ts';
import { DELEGATE_TO_FLAG } from './remote-run.ts';
import { resolveReportFormat } from './report-format.ts';
import { buildRootRegistry, buildWorkspaceRegistry, resolveScript } from './resolver.ts';
import { assembleChain, formatOverrideNotice } from './run-chain.ts';
import type { RunStepsOptions } from './runner.ts';

/** @internal */
export interface RunCliOptions {
  /** Post-slice CLI arguments (equivalent to `process.argv.slice(2)`). */
  args: string[];
  /** Working directory used to resolve the nmr execution context. */
  cwd: string;
  /** Environment from which `runCli` reads its settings, and the base of the one that its children inherit. */
  env: NodeJS.ProcessEnv;
  /** Stream for normal output: help, version, verdicts, recordings, and override notices. */
  stdout: Writable;
  /** Stream for errors, warnings, and debug notes. */
  stderr: Writable;
}

/**
 * Executes the nmr CLI flow in-process and returns the resulting exit code.
 * Does not hold global state, does not read `process.*` globals, and never calls `process.exit`.
 *
 * @internal
 */
export async function runCli(options: RunCliOptions): Promise<RunCliResult> {
  const established = await establishInvocation(options);
  if (established.settled) {
    return { exitCode: established.result.exitCode };
  }
  const invocation = established.value;

  const resolvedTarget = resolveExecutionTarget(invocation);
  if (resolvedTarget.settled) {
    return { exitCode: resolvedTarget.result.exitCode };
  }
  let target = resolvedTarget.value;

  // A fan-out does not have a gate of its own to consult, so the host receives it whole and fans it out there.
  const { filter, recursive } = invocation.parsedArgs;
  if (target.kind === 'remote' && (filter !== undefined || recursive)) {
    const delegated = await runInvocationOnHost(invocation, target);
    if (delegated !== undefined) {
      return delegated;
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

  return { exitCode };
}

/**
 * Reads the arguments, the presentation sources, and the context, and settles every invocation that does not reach
 * a command: an unreadable argument or presentation source, `--version`, and `--help`.
 */
async function establishInvocation(options: RunCliOptions): Promise<PhaseResult<Invocation>> {
  const { args, cwd, env, stdout, stderr } = options;

  const parseResult = parseArgs(args);
  if (!parseResult.ok) {
    reportError(parseResult.error, stderr);
    return { settled: true, result: { exitCode: 1 } };
  }
  const { parsedArgs } = parseResult;

  // Read the presentation sources ahead of every other outcome, `--version` and `--help` included, so that an
  // invalid value fails every invocation alike. The config's own levels resolve later: `--version` does not load
  // the config.
  const presentationRead = readPresentation({
    env,
    flagValue: parsedArgs.outputStyle,
    stderrIsTty: isTerminalStream(stderr),
    stdoutIsTty: isTerminalStream(stdout),
  });
  if (!presentationRead.ok) {
    reportError(presentationRead.error, stderr);
    return { settled: true, result: { exitCode: 1 } };
  }
  const { styles } = presentationRead;

  if (parsedArgs.shouldShowVersion) {
    stdout.write(`${VERSION}\n`);
    return { settled: true, result: { exitCode: 0 } };
  }

  const context = await resolveContext(cwd);

  const format = resolveReportFormat({ envFormat: presentationRead.format, hasJsonFlag: parsedArgs.shouldEmitJson });
  const verbosity = resolveReportingVerbosity({
    env,
    envVerbosity: presentationRead.verbosity,
    format,
    output: context.config.output,
    hasQuietFlag: parsedArgs.quiet,
  });

  const shouldUseRoot = parsedArgs.isWorkspaceRoot || context.isRoot;

  // Anchors registry resolution and execution alike: a script runs in the directory to which its registry belongs.
  const anchorDir = shouldUseRoot ? context.monorepoRoot : (context.packageDir ?? context.monorepoRoot);

  if (parsedArgs.shouldShowHelp || !parsedArgs.command) {
    stdout.write(`${generateHelp(context.config, context.monorepoRoot, anchorDir, shouldUseRoot)}\n`);
    return { settled: true, result: { exitCode: 0 } };
  }

  return {
    settled: false,
    value: {
      anchorDir,
      command: parsedArgs.command,
      context,
      cwd,
      env,
      format,
      parsedArgs,
      scope: path.basename(anchorDir),
      shouldUseRoot,
      stderr,
      stdout,
      styles,
      verbosity,
    },
  };
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
      result = await runDelegation({ context, delegation: heldDelegation, parsedArgs, runOptions, stderr });
    } finally {
      await lock?.release();
    }

    return {
      settled: true,
      result: { ...result, isUnknownCommand: result.exitCode !== 0 && !isDefinedInAnyScope(command, context) },
    };
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
    // Bare `--delegate` followed by a host name is the old spelling of `--delegate-to`.
    const delegateToHint =
      parsedArgs.shouldDelegate && parsedArgs.delegateHosts === undefined
        ? `. \`${command}\` is not a command; name a host with ${DELEGATE_TO_FLAG} ${command}`
        : '';
    reportError(`Unknown command: ${command}${delegateToHint}`, stderr);
    return { settled: true, result: { exitCode: 1, isUnknownCommand: true } };
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
