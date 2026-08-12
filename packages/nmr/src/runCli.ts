import path from 'node:path';
import type { Writable } from 'node:stream';

import { readPackageVersion, reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors/candidate';

import type { BuildOutputState, TreeSnapshot } from './check-cache.ts';
import {
  computeCacheKey,
  CURRENT_RUNTIME,
  encodeTreeSnapshot,
  findStaleBuildOutput,
  formatMisplacedNoCacheWarning,
  NO_CACHE_ENV_VAR,
  readBuildOutputState,
  readCheckCacheEntry,
  resolveCacheableCommands,
  resolveTreeSnapshot,
  TREE_SNAPSHOT_ENV_VAR,
  writeCheckCacheEntry,
  writeDebugNote,
} from './check-cache.ts';
import { resolveConfigPath } from './config.ts';
import { resolveContext } from './context.ts';
import { generateHelp } from './help.ts';
import { isHookName } from './helpers/hook-name.ts';
import type { ScriptRegistry } from './resolve-scripts.ts';
import type { ResolvedScript, ScriptOrigin } from './resolver.ts';
import {
  applyDevBinToSteps,
  buildRootRegistry,
  buildWorkspaceRegistry,
  expandScript,
  resolveScript,
} from './resolver.ts';
import type { RunStepsOptions } from './runner.ts';
import { runSteps } from './runner.ts';
import type { Step } from './steps.ts';
import { composeNmrStep, findNmrCrossing, renderChain } from './steps.ts';
import type { NmrConfig } from './types.ts';
import type { CommandVerbosity } from './verbosity.ts';
import { COMMAND_VERBOSITY_ENV_VAR, resolveVerbosity } from './verbosity.ts';
import type { Verdict, VerdictOutcome } from './verdict.ts';
import { writeVerdict } from './verdict.ts';

const VERSION = readPackageVersion(import.meta.url);

/** The consequence a crossing carries, which every origin's line reports before naming its remedy. */
const CROSSING_CONSEQUENCE = "so nmr handles the nested run's output as a tool's.";

/**
 * Marks a run made on a delegating caller's behalf, where a command the registry does not define exits 0
 * rather than failing.
 */
export const RUN_IF_PRESENT_ENV_VAR = 'NMR_RUN_IF_PRESENT';

/** @internal */
export interface RunCliOptions {
  /** Post-slice CLI arguments (equivalent to `process.argv.slice(2)`). */
  args: string[];
  /** Working directory used to resolve the nmr execution context. */
  cwd: string;
  /** Environment for `runCli` (used for `NMR_RUN_IF_PRESENT` reads and `-R` writes). */
  env: NodeJS.ProcessEnv;
  /** Stream for normal output (help text, override messages). */
  stdout: Writable;
  /** Stream for error output (unknown command, parse errors). */
  stderr: Writable;
}

/** @internal */
export interface RunCliResult {
  exitCode: number;
}

/**
 * Executes the nmr CLI flow in-process and returns the resulting exit code.
 * Holds no global state, reads no `process.*` globals, never calls `process.exit`.
 *
 * @internal
 */
export async function runCli(options: RunCliOptions): Promise<RunCliResult> {
  const { args, cwd, env, stdout, stderr } = options;

  const parseResult = parseArgs(args);
  if (!parseResult.ok) {
    reportError(parseResult.error, stderr);
    return { exitCode: 1 };
  }
  const { parsed } = parseResult;

  // Ahead of every other outcome, `--version` and `--help` included, so one variable's validity has one answer.
  const verbosity = resolveVerbosity(env, parsed.quiet);
  if (!verbosity.ok) {
    reportError(verbosity.error, stderr);
    return { exitCode: 1 };
  }
  if (parsed.version) {
    stdout.write(`${VERSION}\n`);
    return { exitCode: 0 };
  }

  const quiet = verbosity.verbosity === 'quiet';

  const context = await resolveContext(cwd);

  // Determine which registry to use
  const useRoot = parsed.workspaceRoot || context.isRoot;

  // Anchors registry resolution and execution alike: a script runs in the directory its registry belongs to.
  const anchorDir = useRoot ? context.monorepoRoot : (context.packageDir ?? context.monorepoRoot);

  if (parsed.help || !parsed.command) {
    stdout.write(`${generateHelp(context.config, anchorDir, useRoot)}\n`);
    return { exitCode: 0 };
  }

  const { command } = parsed;

  // Hook recursion guard: a command ending in `:pre` or `:post` is a leaf operation, and is not itself
  // wrapped in further hook lookups.
  const isHookInvocation = isHookName(command);
  const scope = path.basename(anchorDir);

  const snapshot = openGate({
    command,
    config: context.config,
    env,
    monorepoRoot: context.monorepoRoot,
    passthrough: parsed.passthrough,
    stderr,
  });

  const noCache = parsed.noCache || env[NO_CACHE_ENV_VAR] === '1';
  const childEnv = buildChildEnv(env, snapshot, noCache, verbosity.verbosity);
  const runOptions: RunStepsOptions = {
    quiet,
    stdout,
    stderr,
    env: childEnv,
  };

  // -F: delegate to pnpm --filter
  if (parsed.filter) {
    const delegate = composeDelegate(['--filter', parsed.filter], command, parsed.passthrough);
    return runSteps([delegate], context.monorepoRoot, runOptions);
  }

  // -R: delegate to pnpm --recursive
  if (parsed.recursive) {
    const delegateEnv = { ...childEnv, [RUN_IF_PRESENT_ENV_VAR]: '1' };
    const delegate = composeDelegate(['--recursive'], command, parsed.passthrough);
    return runSteps([delegate], context.monorepoRoot, { ...runOptions, env: delegateEnv });
  }

  const registry = useRoot ? buildRootRegistry(context.config) : buildWorkspaceRegistry(context.config);
  const resolved = resolveScript(command, registry, anchorDir, parsed.workspaceRoot);

  if (!resolved) {
    if (env[RUN_IF_PRESENT_ENV_VAR] === '1') {
      return { exitCode: 0 };
    }
    reportError(`Unknown command: ${command}`, stderr);
    return { exitCode: 1 };
  }

  const resolvedCommand = renderChain(resolved.steps);

  const noOpReason = findNoOpReason(resolvedCommand);
  if (noOpReason !== undefined) {
    reportVerdict({ command, scope, outcome: 'no-op', reason: noOpReason }, stdout);
    return { exitCode: 0 };
  }

  const substitutedSteps = applyDevBinToSteps(resolved.steps, context.config.devBin, context.monorepoRoot);
  const substitutedCommand = renderChain(substitutedSteps);
  const mainSteps = appendPassthrough(substitutedSteps, parsed.passthrough);

  const fullSteps = isHookInvocation
    ? mainSteps
    : wrapWithHooks(command, mainSteps, registry, anchorDir, parsed.workspaceRoot);
  const fullCommand = renderChain(fullSteps);

  // Ahead of the gate, so a command that usually skips still reports the boundary it carries. Reads the resolved
  // steps rather than the full chain: the line names a declaration to edit, and a hook, a passthrough, and a
  // `devBin` substitution are none.
  const crossing = findNmrCrossing(resolved.steps);
  if (crossing !== undefined) {
    const warning = formatNmrCrossingWarning({
      crossing,
      monorepoRoot: context.monorepoRoot,
      origin: describeOrigin(resolved.origin, context.config, useRoot),
      registry,
      workspaceRoot: parsed.workspaceRoot,
    });
    stderr.write(`${warning}\n`);
  }

  // The key waits until the whole chain is known, so it describes what would actually run: the hooks wrapped
  // around the command included.
  const key = resolveCacheKey({
    anchorDir,
    command,
    commandString: fullCommand,
    env,
    monorepoRoot: context.monorepoRoot,
    snapshot,
    stderr,
    substitution: substitutedCommand === resolvedCommand ? undefined : substitutedCommand,
  });

  const { exitCode, outcome } = await runGated({
    anchorDir,
    command,
    commandString: fullCommand,
    config: context.config,
    steps: fullSteps,
    env,
    key,
    monorepoRoot: context.monorepoRoot,
    noCache,
    overrideNotice: formatOverrideNotice(resolved, registry, command, anchorDir, quiet),
    runOptions,
    snapshot,
    stderr,
    stdout,
  });

  reportVerdict({ command, scope, ...outcome }, stdout);

  return { exitCode };
}

// region | Helpers

/** @internal */
interface ParsedArgs {
  filter?: string;
  noCache: boolean;
  quiet: boolean;
  recursive: boolean;
  workspaceRoot: boolean;
  help: boolean;
  version: boolean;
  command?: string;
  passthrough: string[];
}

type ParseResult = { ok: true; parsed: ParsedArgs } | { ok: false; error: string };

/**
 * Builds the environment every process below this one inherits. The snapshot travels down so a chain of nmr
 * invocations gates on one observation of the tree, a bypass travels down so it covers the whole chain rather
 * than only the command it was typed next to, and the verbosity travels down so each process suppresses the
 * output of the command it runs rather than of the subtree beneath it.
 *
 * The verbosity is written in both modes, so a chain's loudness is decided once at the top rather than
 * re-derived at every link from an environment a caller may have set.
 */
function buildChildEnv(
  env: NodeJS.ProcessEnv,
  snapshot: TreeSnapshot | undefined,
  noCache: boolean,
  verbosity: CommandVerbosity,
): NodeJS.ProcessEnv {
  return {
    ...env,
    ...(snapshot !== undefined && { [TREE_SNAPSHOT_ENV_VAR]: encodeTreeSnapshot(snapshot) }),
    ...(noCache && { [NO_CACHE_ENV_VAR]: '1' }),
    [COMMAND_VERBOSITY_ENV_VAR]: verbosity,
  };
}

/**
 * Appends the invocation's trailing arguments to the last step of the main command, so they reach the command
 * the user named and never a hook wrapped around it.
 */
function appendPassthrough(steps: readonly Step[], passthrough: readonly string[]): readonly Step[] {
  const last = steps.at(-1);
  if (passthrough.length === 0 || last === undefined) {
    return steps;
  }

  const bound: Step =
    last.kind === 'structural'
      ? { kind: 'structural', argv: [...last.argv, ...passthrough] }
      : { kind: 'opaque', command: `${last.command} ${passthrough.map(shellQuote).join(' ')}` };

  return [...steps.slice(0, -1), bound];
}

/**
 * Composes the pnpm delegate that runs a command in other packages. One structural step, so the pattern a `-F`
 * carries and the arguments passed on stay argv tokens rather than text spliced into a shell string, and so the
 * nmr processes underneath write where this one writes although the binary spawned is `pnpm`.
 */
function composeDelegate(scope: readonly string[], command: string, passthrough: readonly string[]): Step {
  return { kind: 'structural', argv: ['pnpm', ...scope, 'exec', 'nmr', command, ...passthrough] };
}

/**
 * Returns what a crossing's line names: the declaration site it leads with, and the edit that resolves it.
 *
 * The remedy follows from the origin rather than naming one tier for every case, so the switch is exhaustive:
 * an origin kind added without a remedy fails to compile.
 */
function describeCrossingRemedy(options: {
  crossing: string;
  monorepoRoot: string;
  origin: DiagnosticOrigin;
  registry: ScriptRegistry;
  workspaceRoot: boolean;
}): { remedy: string; subject: string } {
  const { crossing, monorepoRoot, origin, registry, workspaceRoot } = options;
  const configSite = path.relative(monorepoRoot, resolveConfigPath(monorepoRoot));

  switch (origin.tier) {
    case 'default':
      return {
        remedy: 'A built-in default reaching nmr through a shell is an nmr defect: please report it.',
        subject: `nmr built-in \`${origin.key}\``,
      };
    case 'config':
      return {
        remedy:
          `Write the nmr steps as a step list, and move any others to a \`${origin.key}:pre\` or ` +
          `\`${origin.key}:post\` script.`,
        subject: `${configSite}: \`${origin.field}.${origin.key}\``,
      };
    case 'package':
      return {
        remedy: formatPackageRemedy({ configSite, crossing, key: origin.key, registry, workspaceRoot }),
        subject: `${path.relative(monorepoRoot, origin.file)}: \`scripts.${origin.key}\``,
      };
    default: {
      const unhandled: never = origin;
      throw new Error(`Unhandled script origin: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** A resolved script's origin, refined into the tier whose remedy the diagnostic names. */
type DiagnosticOrigin =
  | { tier: 'default'; key: string }
  | { tier: 'config'; field: 'rootScripts' | 'workspaceScripts'; key: string }
  | { tier: 'package'; file: string; key: string };

/**
 * Refines a resolved script's origin into the tier the diagnostic names.
 *
 * Resolution reports the defaults and the config as one tier, having received them merged. Separating them
 * needs the config, which this holds and resolution does not.
 */
function describeOrigin(origin: ScriptOrigin, config: NmrConfig, useRoot: boolean): DiagnosticOrigin {
  if (origin.tier === 'package') {
    return origin;
  }

  const field = useRoot ? 'rootScripts' : 'workspaceScripts';
  const configScripts = config[field];

  return configScripts !== undefined && Object.hasOwn(configScripts, origin.key)
    ? { tier: 'config', field, key: origin.key }
    : { tier: 'default', key: origin.key };
}

/**
 * Renders the line reporting a step that reaches nmr through a shell, which puts the nested run's output on the
 * channels a tool's takes: withheld as one block under `quiet`, and relayed through this process under `full`.
 *
 * Leads with the declaration site, so each report a recursive run emits names the file it is an edit to, and
 * derives the remedy from that site rather than naming one tier for every case.
 */
function formatNmrCrossingWarning(options: {
  crossing: string;
  monorepoRoot: string;
  origin: DiagnosticOrigin;
  registry: ScriptRegistry;
  workspaceRoot: boolean;
}): string {
  const { remedy, subject } = describeCrossingRemedy(options);

  return `⚠️ ${subject} reaches nmr through a shell (\`${options.crossing}\`), ${CROSSING_CONSEQUENCE} ${remedy}`;
}

/**
 * Returns the line announcing that a `package.json` script is standing in for a built-in, or `undefined` when
 * none is due. Only a script replacing a name the registry already defines is worth announcing; an ordinary
 * tier-3 entry that happens to resolve is not standing in for anything.
 */
function formatOverrideNotice(
  resolved: ResolvedScript,
  registry: ScriptRegistry,
  command: string,
  anchorDir: string,
  quiet: boolean,
): string | undefined {
  const registryEntry = Object.hasOwn(registry, command) ? registry[command] : undefined;
  if (quiet || resolved.origin.tier !== 'package' || registryEntry === undefined) {
    return undefined;
  }

  return `📦 ${path.basename(anchorDir)}: Using override script: ${renderChain(resolved.steps)}\n`;
}

/**
 * Returns the edit that resolves a crossing declared in a `package.json`, which holds no step list of its own.
 *
 * The entry has to go either way; where its steps go depends on what the registry already defines for the
 * command, so an override merely restating that entry is told to be deleted outright. A step list holds nmr
 * commands alone, so anything else the entry runs is named for a hook rather than for the list.
 */
function formatPackageRemedy(options: {
  configSite: string;
  crossing: string;
  key: string;
  registry: ScriptRegistry;
  workspaceRoot: boolean;
}): string {
  const { configSite, crossing, key, registry, workspaceRoot } = options;
  const registryEntry = Object.hasOwn(registry, key) ? registry[key] : undefined;

  if (registryEntry === undefined) {
    return (
      `A \`package.json\` script holds no step list: define \`${key}\` in \`${configSite}\` and move the ` +
      `package-specific steps to a \`${key}:pre\` or \`${key}:post\` script.`
    );
  }

  const registryChain = renderChain(expandScript(registryEntry, workspaceRoot));
  if (registryChain === crossing) {
    return `Delete the entry: nmr's own \`${key}\` already runs \`${registryChain}\`.`;
  }

  return `Delete the entry and move the steps it adds to a \`${key}:pre\` or \`${key}:post\` script.`;
}

/**
 * Returns why a resolved command runs nothing, or `undefined` when there is something to run. A command that
 * ran nothing is not a command that passed, and the two exit alike, so the reason is what a verdict spends on
 * telling them apart.
 */
function findNoOpReason(resolvedCommand: string): 'empty-override' | 'noop-override' | undefined {
  if (resolvedCommand === '') {
    return 'empty-override';
  }
  if (resolvedCommand === ':') {
    return 'noop-override';
  }
  return undefined;
}

/**
 * Returns true when a hook script resolves to a runnable command.
 * A hook is runnable when it resolves and the resolved value is neither
 * `""` nor `":"` (both of which mean "skip").
 */
function hasRunnableHook(
  hookName: string,
  registry: ScriptRegistry,
  anchorDir: string,
  workspaceRoot: boolean,
): boolean {
  const resolved = resolveScript(hookName, registry, anchorDir, workspaceRoot);
  if (!resolved) return false;

  const chain = renderChain(resolved.steps);
  return chain !== '' && chain !== ':';
}

/**
 * Returns the age and saving a recalled pass reports when a recorded pass covers this invocation, or
 * `undefined` when the command has to run. A key match alone is not a pass: the build output the key says
 * nothing about has to still be on disk, and the run that follows a missing-output miss is what restores it.
 */
async function lookUpRecordedPass(options: {
  anchorDir: string;
  buildOutput: BuildOutputState;
  command: string;
  env: NodeJS.ProcessEnv;
  key: string;
  monorepoRoot: string;
  stderr: Writable;
}): Promise<{ ageMs: number; savedMs: number } | undefined> {
  const { anchorDir, buildOutput, command, env, key, monorepoRoot, stderr } = options;

  const entry = await readCheckCacheEntry({ anchorDir, command, monorepoRoot });
  if (entry === undefined) {
    writeDebugNote(`running ${command}: no pass recorded for this scope`, env, stderr);
    return undefined;
  }
  if (entry.key !== key) {
    writeDebugNote(`running ${command}: the tree or its inputs changed since the last pass`, env, stderr);
    return undefined;
  }

  const [missing] = buildOutput.missing;
  if (missing !== undefined) {
    writeDebugNote(`running ${command}: ${missing} has no build output`, env, stderr);
    return undefined;
  }

  // Presence alone would let a `dist` compiled from another tree pass for this one: git ignores build output,
  // so restoring a tree restores none of it, and the run that would have rebuilt it is the one being skipped.
  const stale = findStaleBuildOutput(entry.buildDigests, buildOutput.digests);
  if (stale !== undefined) {
    writeDebugNote(`running ${command}: ${stale}'s build output came from a different tree`, env, stderr);
    return undefined;
  }

  return { ageMs: Math.max(0, Date.now() - Date.parse(entry.recordedAt)), savedMs: entry.durationMs };
}

/**
 * Decides whether the check-result cache covers this invocation, and takes the tree snapshot it would gate on.
 * Returns `undefined` when the gate stands aside, which always means the command runs.
 *
 * Decided before anything is resolved or spawned, so that a delegating invocation hands the snapshot to its
 * children rather than leaving each of them to hash the tree again. A hook leaf is out of scope because it is
 * not a command anyone asks for: it runs as part of the chain the gate already covers. Arguments are out of
 * scope because they change what a command does in ways the gate has no way to read.
 */
function openGate(options: {
  command: string;
  config: NmrConfig;
  env: NodeJS.ProcessEnv;
  monorepoRoot: string;
  passthrough: string[];
  stderr: Writable;
}): TreeSnapshot | undefined {
  const { command, config, env, monorepoRoot, passthrough, stderr } = options;

  const covered =
    !isHookName(command) &&
    config.checkCache?.enabled !== false &&
    resolveCacheableCommands(config.checkCache).has(command);
  if (!covered) {
    return undefined;
  }

  // A `--no-cache` past the command name is an argument to that command, and is passed on as one. Saying so is
  // all that stands between a developer and a bypass they believe happened.
  if (passthrough.includes('--no-cache')) {
    stderr.write(`${formatMisplacedNoCacheWarning(command)}\n`);
  }
  if (passthrough.length > 0) {
    return undefined;
  }

  const snapshot = resolveTreeSnapshot({ monorepoRoot, env });
  if (!snapshot.ok) {
    writeDebugNote(`gate disabled: ${snapshot.reason}`, env, stderr);
    return undefined;
  }

  return snapshot.snapshot;
}

function parseArgs(args: string[]): ParseResult {
  const parsed: ParsedArgs = {
    noCache: false,
    quiet: false,
    recursive: false,
    workspaceRoot: false,
    help: false,
    version: false,
    passthrough: [],
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === undefined) break;

    if (arg === '-F' || arg === '--filter') {
      i++;
      const filterValue = args[i];
      if (filterValue === undefined) {
        return { ok: false, error: '-F/--filter requires a pattern argument' };
      }
      parsed.filter = filterValue;
      i++;
      continue;
    }
    if (arg === '-R' || arg === '--recursive') {
      parsed.recursive = true;
      i++;
      continue;
    }
    if (arg === '-w' || arg === '--workspace-root') {
      parsed.workspaceRoot = true;
      i++;
      continue;
    }
    if (arg === '-?' || arg === '--help') {
      parsed.help = true;
      i++;
      continue;
    }
    if (arg === '-V' || arg === '--version') {
      parsed.version = true;
      i++;
      continue;
    }
    if (arg === '-q' || arg === '--quiet') {
      parsed.quiet = true;
      i++;
      continue;
    }
    if (arg === '--no-cache') {
      parsed.noCache = true;
      i++;
      continue;
    }

    // First non-flag argument is the command; rest is passthrough
    parsed.command = arg;
    parsed.passthrough = args.slice(i + 1);
    break;
  }

  return { ok: true, parsed };
}

/**
 * Reports an invocation's verdict, unless the levels around it already report for it.
 *
 * A hook leaf reports none: it is not a command anyone asked for, but part of the chain the level that wrapped
 * it reports on, and a line here would say the same thing twice under a different name. A delegating
 * invocation reports none either, and needs no test here -- it returns before a verdict is composed, every
 * scope it fans out to reporting one of its own.
 */
function reportVerdict(verdict: Verdict, stdout: Writable): void {
  if (isHookName(verdict.command)) {
    return;
  }
  writeVerdict(verdict, stdout);
}

/**
 * Records a pass, unless what the check was asked about moved while it ran: a rewritten file describes a tree
 * that no longer exists, and build output that changed leaves no answer to which output the pass was earned
 * over. Recording either would certify content nothing ran against. The recorded key is the one the snapshot
 * produced, so every entry from one invocation refers to one tree.
 *
 * A cache that cannot be written is not worth failing a green run over, so that failure goes to the debug note.
 */
async function recordPass(options: {
  anchorDir: string;
  buildOutputBefore: BuildOutputState;
  command: string;
  commandString: string;
  config: NmrConfig;
  durationMs: number;
  env: NodeJS.ProcessEnv;
  key: string;
  monorepoRoot: string;
  snapshot: TreeSnapshot;
  stderr: Writable;
}): Promise<void> {
  const { anchorDir, command, env, monorepoRoot, snapshot, stderr } = options;

  // Hashed afresh rather than inherited: an inherited snapshot is the observation this is meant to re-test.
  const current = resolveTreeSnapshot({ monorepoRoot, env: {} });
  if (!current.ok) {
    writeDebugNote(`not recording ${command}: ${current.reason}`, env, stderr);
    return;
  }
  if (current.snapshot.hash !== snapshot.hash) {
    writeDebugNote(`not recording ${command}: the tree changed while it ran`, env, stderr);
    return;
  }

  // Read after the chain, so the digests describe the output the pass was actually earned over. A pass over a
  // repository still missing output describes a state no later run should be held to, so it is not recorded.
  const output = await readBuildOutputState(monorepoRoot, options.config);
  const [missing] = output.missing;
  if (missing !== undefined) {
    writeDebugNote(`not recording ${command}: ${missing} has no build output`, env, stderr);
    return;
  }

  // The check read one output and the entry would record the other, so neither describes the pass. A chain that
  // builds its own covered output disagrees with itself here and declines for the same reason.
  const changed = findStaleBuildOutput(options.buildOutputBefore.digests, output.digests);
  if (changed !== undefined) {
    writeDebugNote(`not recording ${command}: ${changed}'s build output changed while it ran`, env, stderr);
    return;
  }

  try {
    await writeCheckCacheEntry({
      anchorDir,
      command,
      monorepoRoot,
      entry: {
        key: options.key,
        treeHash: snapshot.hash,
        headSha: snapshot.headSha,
        commandString: options.commandString,
        nmrVersion: VERSION,
        nodeVersion: CURRENT_RUNTIME.nodeVersion,
        durationMs: options.durationMs,
        recordedAt: new Date().toISOString(),
        buildDigests: output.digests,
      },
    });
  } catch (error: unknown) {
    const message = describeError(error);
    writeDebugNote(`could not record ${command}: ${message}`, env, stderr);
  }
}

/**
 * Computes the key this invocation would be recorded under, or `undefined` when the gate stands aside. A
 * `devBin` substitution takes it aside: the substitute is built from somewhere the tree hash does not describe,
 * so a pass by it is not a pass by the command the key names.
 */
function resolveCacheKey(options: {
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
 * invocation, and records a pass when one is earned. Returns the exit code and the outcome a verdict reports,
 * either way.
 *
 * The override notice waits until the command is going to run, because naming the script that stands in for a
 * built-in says nothing useful about an invocation that skipped it.
 */
async function runGated(options: {
  anchorDir: string;
  command: string;
  commandString: string;
  config: NmrConfig;
  env: NodeJS.ProcessEnv;
  key: string | undefined;
  monorepoRoot: string;
  noCache: boolean;
  overrideNotice: string | undefined;
  runOptions: RunStepsOptions;
  snapshot: TreeSnapshot | undefined;
  steps: readonly Step[];
  stderr: Writable;
  stdout: Writable;
}): Promise<{ exitCode: number; outcome: VerdictOutcome }> {
  const { anchorDir, command, commandString, env, key, monorepoRoot, snapshot, stderr, stdout } = options;

  // The build output is read before the run, so a pass can be held to the output the run actually saw. One
  // reading serves the lookup and the recording alike, and `--no-cache` bypasses only the former.
  const gate =
    key !== undefined && snapshot !== undefined
      ? { buildOutputBefore: await readBuildOutputState(monorepoRoot, options.config), key, snapshot }
      : undefined;

  if (gate !== undefined && !options.noCache) {
    const recalled = await lookUpRecordedPass({
      anchorDir,
      buildOutput: gate.buildOutputBefore,
      command,
      env,
      key: gate.key,
      monorepoRoot,
      stderr,
    });
    if (recalled !== undefined) {
      return { exitCode: 0, outcome: { outcome: 'recalled', ...recalled } };
    }
  }

  if (options.overrideNotice !== undefined) {
    stdout.write(options.overrideNotice);
  }

  const startedAt = Date.now();
  const { exitCode } = await runSteps(options.steps, anchorDir, options.runOptions);
  const durationMs = Date.now() - startedAt;

  if (exitCode === 0 && gate !== undefined) {
    await recordPass({
      anchorDir,
      buildOutputBefore: gate.buildOutputBefore,
      command,
      commandString,
      config: options.config,
      durationMs,
      env,
      key: gate.key,
      monorepoRoot,
      snapshot: gate.snapshot,
      stderr,
    });
  }

  return {
    exitCode,
    outcome: exitCode === 0 ? { outcome: 'passed', durationMs } : { outcome: 'failed', durationMs, exitCode },
  };
}

/**
 * Shell-escapes a single argument by wrapping in single quotes
 * and escaping any embedded single quotes.
 */
function shellQuote(arg: string): string {
  return "'" + arg.replace(/'/g, String.raw`'\''`) + "'";
}

/**
 * Wraps a resolved main command's steps with `nmr <command>:pre` and `nmr <command>:post`
 * steps when the corresponding hooks resolve to non-skip values.
 *
 * Hooks are looked up via the same 3-tier registry as the main command. Missing
 * hooks (and explicit `""`/`":"` skips) are silent — they do not appear in the
 * chain and produce no output. Hook failure ends the sequence; the failing exit
 * code propagates.
 *
 * `-w` is propagated to hook subprocesses so each hook selects the root registry
 * on its own, independent of where the child derives its context from.
 */
function wrapWithHooks(
  command: string,
  mainSteps: readonly Step[],
  registry: ScriptRegistry,
  anchorDir: string,
  workspaceRoot: boolean,
): readonly Step[] {
  const steps: Step[] = [];

  if (hasRunnableHook(`${command}:pre`, registry, anchorDir, workspaceRoot)) {
    steps.push(composeNmrStep(`${command}:pre`, workspaceRoot));
  }
  steps.push(...mainSteps);
  if (hasRunnableHook(`${command}:post`, registry, anchorDir, workspaceRoot)) {
    steps.push(composeNmrStep(`${command}:post`, workspaceRoot));
  }

  return steps;
}

// endregion | Helpers
