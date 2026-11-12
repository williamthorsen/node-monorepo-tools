import path from 'node:path';
import type { Writable } from 'node:stream';

import { type CommandNode, createCli, type ParsedFlags, UsageError } from '@williamthorsen/nmr-core/cli';

import { DEBUG_ENV_VAR, NO_CACHE_ENV_VAR } from './check-cache/check-cache.ts';
import type { ResolvedContext } from './context.ts';
import { readEnvSwitch, readEnvSwitches } from './env-switch.ts';
import { listDefinedCommands } from './fan-out.ts';
import { describeHelp } from './help.ts';
import type { ReadFilterSelection } from './helpers/filter-selection.ts';
import { type Invocation, RUN_IF_PRESENT_ENV_VAR } from './invocation.ts';
import { NO_LOCK_ENV_VAR } from './machine-lock.ts';
import { NMR_FLAGS, type ParsedArgs, toParsedArgs } from './nmr-flags.ts';
import { isTerminalStream } from './output-style.ts';
import { readPresentation, resolveReportingVerbosity } from './presentation.ts';
import { resolveReportFormat } from './report-format.ts';
import type { RunSteps } from './runner.ts';

/** The on/off switches that nmr reads from the environment, which it validates before any command runs. */
const ENV_SWITCH_NAMES = [DEBUG_ENV_VAR, NO_CACHE_ENV_VAR, NO_LOCK_ENV_VAR, RUN_IF_PRESENT_ENV_VAR] as const;

/** What the command tree of one invocation is built from. */
export interface RouteInput {
  context: ResolvedContext;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** The invocation's flags as the first pass read them, or `undefined` when they do not parse. */
  firstPass: ParsedArgs | undefined;
  readFilterSelection: ReadFilterSelection;
  /** Runs an invocation that reached a command and resolves to its exit code. */
  runInvocation: (invocation: Invocation) => Promise<number>;
  runSteps: RunSteps;
  stderr: Writable;
  stdout: Writable;
}

/** An invocation before the command that it names is known. */
type InvocationBase = Omit<Invocation, 'command'>;

const { defineGroup } = createCli<undefined>();
const { defineCommand } = createCli<InvocationBase>();

/**
 * Builds the command tree of one invocation: nmr's flags, and a passthrough command for each script that help lists
 * for the scope.
 *
 * The command that the invocation names is added when any scope defines it, or when nmr answers for it on its own
 * (a run on a delegating caller's behalf, or a host name after a bare `--delegate`), so that nmr rather than the
 * router decides what an invocation that a scope cannot run reports. A request for help adds nothing, so that help
 * lists the scope alone.
 */
export function buildRoot(input: RouteInput): CommandNode<undefined> {
  const { context, env, firstPass } = input;
  const shouldUseRoot = (firstPass?.isWorkspaceRoot ?? false) || context.isRoot;
  const anchorDir = resolveAnchorDir(context, shouldUseRoot);
  const listing = describeHelp(context.config, context.monorepoRoot, anchorDir, shouldUseRoot);

  const commands: Record<string, CommandNode<InvocationBase>> = {};
  for (const [name, summary] of listing.commands) {
    commands[name] = defineScriptCommand(name, summary, input);
  }

  const command = firstPass?.command;
  if (command !== undefined && !firstPass?.shouldShowHelp && !Object.hasOwn(commands, command)) {
    // An unreadable `NMR_RUN_IF_PRESENT` adds the command too, so that `deriveInvocation` rejects the value rather
    // than the router reporting the command as unknown.
    const runIfPresent = readEnvSwitch(env, RUN_IF_PRESENT_ENV_VAR);
    const isAnsweredByNmr =
      !runIfPresent.ok ||
      runIfPresent.isOn ||
      (firstPass?.shouldDelegate === true && firstPass.delegateHosts === undefined) ||
      listDefinedCommands(context).has(command);
    if (isAnsweredByNmr) {
      commands[command] = defineScriptCommand(command, 'A script that another scope defines', input);
    }
  }

  return defineGroup({
    summary: 'Runs the scripts of a pnpm monorepo in the scope of the current directory',
    flags: NMR_FLAGS,
    deriveContext: (flags) => deriveInvocation(flags, input),
    commands,
    epilog: listing.epilog,
  });
}

/** Builds a root that does not have any commands, which answers `--version` without loading the config. */
export function buildVersionRoot(): CommandNode<undefined> {
  return defineGroup({ summary: 'nmr', flags: NMR_FLAGS, commands: {} });
}

// region | Helpers

/** Defines the passthrough command that runs one script, handing every argument after its name to the script. */
function defineScriptCommand(name: string, summary: string, input: RouteInput): CommandNode<InvocationBase> {
  return defineCommand({
    summary,
    passthrough: true,
    run: ({ args, context }) =>
      input.runInvocation({
        ...context,
        command: name,
        parsedArgs: { ...context.parsedArgs, command: name, passthrough: args },
      }),
  });
}

/**
 * Reads the presentation sources and the environment switches and resolves where the invocation runs, rejecting a
 * presentation value that does not name a setting, a switch that is neither on nor off, and a `--log` that does not
 * name a command.
 */
function deriveInvocation(flags: ParsedFlags<typeof NMR_FLAGS>, input: RouteInput): InvocationBase {
  const { context, cwd, env, firstPass, readFilterSelection, runSteps, stderr, stdout } = input;
  const parsedArgs = toParsedArgs(flags, []);

  const presentationRead = readPresentation({
    env,
    flagValue: parsedArgs.outputStyle,
    stderrIsTty: isTerminalStream(stderr),
    stdoutIsTty: isTerminalStream(stdout),
  });
  if (!presentationRead.ok) {
    throw new UsageError(presentationRead.error);
  }

  const switchError = readEnvSwitches(env, ENV_SWITCH_NAMES);
  if (switchError !== undefined) {
    throw new UsageError(switchError);
  }

  // `--log` names what to print rather than what to run, so without a command it has asked for nothing.
  if (parsedArgs.shouldPrintLog && firstPass?.command === undefined) {
    throw new UsageError('--log requires a command name: `nmr --log <command>`');
  }

  const format = resolveReportFormat({ envFormat: presentationRead.format, hasJsonFlag: parsedArgs.shouldEmitJson });
  const verbosity = resolveReportingVerbosity({
    env,
    envVerbosity: presentationRead.verbosity,
    format,
    output: context.config.output,
    hasQuietFlag: parsedArgs.quiet,
  });
  const shouldUseRoot = parsedArgs.isWorkspaceRoot || context.isRoot;
  const anchorDir = resolveAnchorDir(context, shouldUseRoot);

  return {
    anchorDir,
    context,
    cwd,
    env,
    format,
    parsedArgs,
    readFilterSelection,
    runSteps,
    scope: path.basename(anchorDir),
    shouldUseRoot,
    stderr,
    stdout,
    styles: presentationRead.styles,
    verbosity,
  };
}

/** Returns the directory to which the invocation's registry belongs, and in which its script runs. */
function resolveAnchorDir(context: ResolvedContext, shouldUseRoot: boolean): string {
  return shouldUseRoot ? context.monorepoRoot : (context.packageDir ?? context.monorepoRoot);
}

// endregion | Helpers
