import path from 'node:path';
import type { Writable } from 'node:stream';

import {
  describeInvalidOutputStyle,
  formatGlyphLine,
  type OutputStyle,
  readPackageVersion,
  reportError,
  STATUS_GLYPHS,
  type StreamStyles,
} from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import {
  type BuildOutputState,
  certifyRetention,
  type CheckCacheEntry,
  computeCacheKey,
  computeRetentionKey,
  CURRENT_RUNTIME,
  encodeTreeSnapshot,
  findStaleBuildOutput,
  formatMisplacedNoCacheWarning,
  isCacheableCommand,
  NO_CACHE_ENV_VAR,
  readBuildOutputState,
  readCheckCacheEntry,
  recordTranscript,
  type ReplayLine,
  resolveRunId,
  resolveTreeSnapshot,
  type Retention,
  RUN_ID_ENV_VAR,
  TREE_SNAPSHOT_ENV_VAR,
  type TreeSnapshot,
  writeCheckCacheEntry,
  writeDebugNote,
} from './check-cache.ts';
import { resolveContext, type ResolvedContext } from './context.ts';
import { NMR_GLYPHS } from './glyphs.ts';
import { generateHelp } from './help.ts';
import { resolveConfigPath } from './helpers/config-path.ts';
import { deriveExcerpt } from './helpers/deriveExcerpt.ts';
import { type FilterSelection, readFilterSelection } from './helpers/filter-selection.ts';
import { findClosestName } from './helpers/findClosestName.ts';
import { isHookName } from './helpers/hook-name.ts';
import { resolvePackageJsonPath } from './helpers/package-json.ts';
import { composeTranscript } from './helpers/transcript.ts';
import { isTerminalStream, OUTPUT_STYLE_ENV_VAR, OUTPUT_STYLE_FLAG, resolveOutputStyles } from './output-style.ts';
import { renderRecording, renderRefusal, resolveRecording } from './recording.ts';
import { assembleReplay } from './replay-assembly.ts';
import { readReportFormatEnv, REPORT_FORMAT_ENV_VAR, type ReportFormat, resolveReportFormat } from './report-format.ts';
import type { ScriptRegistry } from './resolve-scripts.ts';
import {
  applyDevBinToSteps,
  buildRootRegistry,
  buildWorkspaceRegistry,
  expandScript,
  findChainedSelfReference,
  type ResolvedScript,
  resolveScript,
  type ScriptOrigin,
} from './resolver.ts';
import { resolveChannel, type RetainedOutput, runSteps, type RunStepsOptions } from './runner.ts';
import { composeNmrStep, dropRecursiveSteps, findNmrCrossing, renderChain, type Step } from './steps.ts';
import type { NmrConfig } from './types.ts';
import { UserError } from './UserError.ts';
import {
  COMMAND_VERBOSITY_ENV_VAR,
  type CommandVerbosity,
  readVerbosityEnv,
  resolveVerbosity,
  type ResolveVerbosityOptions,
} from './verbosity.ts';
import { type NoOpReason, type Verdict, type VerdictOutcome, writeVerdict } from './verdict.ts';
import { diagnoseEmptyWorkspace, readWorkspacePackageNames } from './workspace.ts';

const VERSION = readPackageVersion(import.meta.url);

/** The consequence a crossing carries, which every origin's line reports before naming its remedy. */
const CROSSING_CONSEQUENCE = "so nmr handles the nested run's output as a tool's.";

/** Leads the line a recursive invocation gets where the workspace it would fan out to holds no package. */
const RECURSIVE_REJECTION = '-R/--recursive matched no workspace:';

/** How many items a diagnostic lists before it reports the rest as a count. */
const LIST_CEILING = 10;

/**
 * The control characters a declaration's text renders as an escape, paired with the escape a JSON string
 * spells them with. `\n` and `\r` are what break a diagnostic across lines; `\t` is the third a script value
 * realistically carries.
 */
const NAMED_ESCAPES = new Map([
  ['\n', String.raw`\n`],
  ['\r', String.raw`\r`],
  ['\t', String.raw`\t`],
]);

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

  // Ahead of every other outcome, `--version` and `--help` included, so one source's validity has one answer.
  // The levels below the environment wait on the config, which `--version` must keep not loading.
  const presentationRead = readPresentation({
    env,
    flagValue: parsed.outputStyle,
    stderrIsTty: isTerminalStream(stderr),
    stdoutIsTty: isTerminalStream(stdout),
  });
  if (!presentationRead.ok) {
    reportError(presentationRead.error, stderr);
    return { exitCode: 1 };
  }
  const { styles } = presentationRead;

  if (parsed.shouldShowVersion) {
    stdout.write(`${VERSION}\n`);
    return { exitCode: 0 };
  }

  const context = await resolveContext(cwd);

  const format = resolveReportFormat({ envFormat: presentationRead.format, hasJsonFlag: parsed.shouldEmitJson });
  const verbosity = resolveReportingVerbosity({
    env,
    envVerbosity: presentationRead.verbosity,
    format,
    output: context.config.output,
    hasQuietFlag: parsed.quiet,
  });
  const quiet = verbosity === 'quiet';

  // Determine which registry to use
  const shouldUseRoot = parsed.isWorkspaceRoot || context.isRoot;

  // Anchors registry resolution and execution alike: a script runs in the directory its registry belongs to.
  const anchorDir = shouldUseRoot ? context.monorepoRoot : (context.packageDir ?? context.monorepoRoot);

  if (parsed.shouldShowHelp || !parsed.command) {
    stdout.write(`${generateHelp(context.config, anchorDir, shouldUseRoot)}\n`);
    return { exitCode: 0 };
  }

  const { command } = parsed;

  const scope = path.basename(anchorDir);

  const snapshot = openGate({
    command,
    config: context.config,
    env,
    monorepoRoot: context.monorepoRoot,
    passthrough: parsed.passthrough,
    stderr,
    style: styles.stderr,
  });

  const shouldBypassCache = parsed.shouldBypassCache || env[NO_CACHE_ENV_VAR] === '1';
  const runId = resolveRunId(env);
  const childEnv = buildChildEnv({
    env,
    format,
    shouldBypassCache,
    passthrough: parsed.passthrough,
    runId,
    snapshot,
    styles,
    verbosity,
  });
  const runOptions: RunStepsOptions = {
    quiet,
    stdout,
    stderr,
    env: childEnv,
  };

  // -F and -R: delegate to pnpm, which runs one nmr per scope it selects
  const delegation = composeDelegation({ childEnv, command, parsedArgs: parsed });
  if (delegation !== undefined) {
    return runDelegation({ context, delegation, parsedArgs: parsed, runOptions, stderr });
  }

  const registry = shouldUseRoot ? buildRootRegistry(context.config) : buildWorkspaceRegistry(context.config);

  assertNoSelfReference({
    anchorDir,
    command,
    isReading: parsed.shouldPrintLog,
    isWorkspaceRoot: parsed.isWorkspaceRoot,
    monorepoRoot: context.monorepoRoot,
    registry,
  });

  const resolvedScript = resolveScript(command, registry, anchorDir, parsed.isWorkspaceRoot);

  if (!resolvedScript) {
    if (env[RUN_IF_PRESENT_ENV_VAR] === '1') {
      return { exitCode: 0 };
    }
    reportError(`Unknown command: ${command}`, stderr);
    return { exitCode: 1 };
  }

  // Ahead of the rendering, which is the cache key and what `--log` resolves: a filter applied later would let
  // a run and a reading of its recording disagree about what the chain was.
  const { isEmptiedByWorkspace, steps: runnableSteps } = readRunnableSteps(
    resolvedScript,
    context.workspacePackageDirs,
  );

  const resolvedCommand = renderChain(runnableSteps);

  const noOpReason = findNoOpReason(resolvedCommand, isEmptiedByWorkspace);
  if (noOpReason !== undefined && !parsed.shouldPrintLog) {
    reportVerdict({ command, scope, outcome: 'no-op', reason: noOpReason }, stdout, format, styles.stdout);
    return { exitCode: 0 };
  }

  const substitutedSteps = applyDevBinToSteps(runnableSteps, context.config.devBin, context.monorepoRoot);
  const substitutedCommand = renderChain(substitutedSteps);

  // Ahead of the recording branch as well as the run, so that reading what a command did and running it answer
  // an unroutable argument the same way.
  const bindResult = bindPassthrough(substitutedSteps, parsed.passthrough, command);
  if (!bindResult.ok) {
    reportError(bindResult.error, stderr);
    return { exitCode: 1 };
  }

  const mainSteps = bindResult.steps;

  // Hook recursion guard: a command ending in `:pre` or `:post` is a leaf operation, and is not itself
  // wrapped in further hook lookups.
  const isHookInvocation = isHookName(command);
  const fullSteps = isHookInvocation
    ? mainSteps
    : wrapWithHooks(command, mainSteps, registry, anchorDir, parsed.isWorkspaceRoot);
  const fullCommand = renderChain(fullSteps);

  reportNmrCrossing({
    config: context.config,
    isReading: parsed.shouldPrintLog,
    isWorkspaceRoot: parsed.isWorkspaceRoot,
    monorepoRoot: context.monorepoRoot,
    registry,
    resolvedScript,
    shouldUseRoot,
    stderr,
    style: styles.stderr,
  });

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

  // Reading a recording is not running one: the branch takes over once the key describing this chain is in
  // hand, and nothing below it -- hook, verdict, or cache write -- is reached.
  if (parsed.shouldPrintLog) {
    return reportRecording({
      anchorDir,
      command,
      commandString: fullCommand,
      config: context.config,
      env,
      key,
      monorepoRoot: context.monorepoRoot,
      scope,
      snapshot,
      stderr,
      stdout,
      styles,
    });
  }

  const { exitCode, outcome } = await runGated({
    anchorDir,
    command,
    commandString: fullCommand,
    config: context.config,
    steps: fullSteps,
    env,
    key,
    monorepoRoot: context.monorepoRoot,
    overrideNotice: formatOverrideNotice(resolvedScript, registry, command, anchorDir, quiet, styles.stdout),
    ownSteps: mainSteps,
    runId,
    runOptions,
    shouldBypassCache,
    snapshot,
    stderr,
    stdout,
  });

  reportVerdict({ command, scope, ...outcome }, stdout, format, styles.stdout);

  return { exitCode };
}

// region | Helpers

/** @internal */
interface ParsedArgs {
  filter?: string;
  isWorkspaceRoot: boolean;
  /** The flag's value as it was written, which the style resolver rather than the parser narrows. */
  outputStyle?: string;
  quiet: boolean;
  recursive: boolean;
  shouldBypassCache: boolean;
  shouldEmitJson: boolean;
  shouldPrintLog: boolean;
  shouldShowHelp: boolean;
  shouldShowVersion: boolean;
  command?: string;
  passthrough: string[];
}

type ParseResult = { ok: true; parsed: ParsedArgs } | { ok: false; error: string };

/** A field a flag sets by being written, none of which takes a value of its own. */
type BooleanFlagName =
  | 'isWorkspaceRoot'
  | 'quiet'
  | 'recursive'
  | 'shouldBypassCache'
  | 'shouldEmitJson'
  | 'shouldPrintLog'
  | 'shouldShowHelp'
  | 'shouldShowVersion';

/** What the presentation sources came to, or the message naming why one of them could not be read. */
type PresentationRead =
  | { ok: true; format: ReportFormat | undefined; styles: StreamStyles; verbosity: CommandVerbosity | undefined }
  | { ok: false; error: string };

/** What `--output-style` was given, and how many arguments it spent, or why the flag carried no value. */
type OutputStyleArgumentRead = { ok: true; value: string; consumed: number } | { ok: false; error: string };

/** Every spelling of a boolean flag, paired with the field it sets. */
const BOOLEAN_FLAGS = new Map<string, BooleanFlagName>([
  ['-?', 'shouldShowHelp'],
  ['--help', 'shouldShowHelp'],
  ['--json', 'shouldEmitJson'],
  ['--log', 'shouldPrintLog'],
  ['--no-cache', 'shouldBypassCache'],
  ['-q', 'quiet'],
  ['--quiet', 'quiet'],
  ['-R', 'recursive'],
  ['--recursive', 'recursive'],
  ['-V', 'shouldShowVersion'],
  ['--version', 'shouldShowVersion'],
  ['-w', 'isWorkspaceRoot'],
  ['--workspace-root', 'isWorkspaceRoot'],
]);

/**
 * Builds the environment every process below this one inherits. The snapshot travels down so a chain of nmr
 * invocations gates on one observation of the tree, a bypass travels down so it covers the whole chain rather
 * than only the command it was typed next to, the verbosity travels down so each process suppresses the
 * output of the command it runs rather than of the subtree beneath it, and the run's identity travels down so
 * the excerpts a run records at every scope are recognizable as one run's.
 *
 * The verbosity is written in both modes, so a chain's loudness is decided once at the top rather than
 * re-derived at every link from an environment a caller may have set.
 *
 * Trailing arguments bypass alongside `--no-cache`, which is why the passthrough is read here rather than
 * folded into `shouldBypassCache` by the caller: `openGate` has already stood this invocation's own gate down for them,
 * but the steps below it are separate nmr invocations carrying none of their own, so a narrowed command would
 * otherwise serve part of its work from a recorded pass.
 *
 * The style written down is the resolved one and never `auto`, so a child on a pipe renders as this process
 * does rather than detecting plain on its own descriptor. It is the style stdout resolved to: the verdicts and
 * nearly every other line a child prints go there.
 */
function buildChildEnv(options: {
  env: NodeJS.ProcessEnv;
  format: ReportFormat;
  passthrough: readonly string[];
  runId: string;
  shouldBypassCache: boolean;
  snapshot: TreeSnapshot | undefined;
  styles: StreamStyles;
  verbosity: CommandVerbosity;
}): NodeJS.ProcessEnv {
  const { env, format, passthrough, runId, shouldBypassCache, snapshot, styles, verbosity } = options;

  const bypassesCache = shouldBypassCache || passthrough.length > 0;

  return {
    ...env,
    ...(snapshot !== undefined && { [TREE_SNAPSHOT_ENV_VAR]: encodeTreeSnapshot(snapshot) }),
    ...(bypassesCache && { [NO_CACHE_ENV_VAR]: '1' }),
    [COMMAND_VERBOSITY_ENV_VAR]: verbosity,
    [OUTPUT_STYLE_ENV_VAR]: styles.stdout,
    [REPORT_FORMAT_ENV_VAR]: format,
    [RUN_ID_ENV_VAR]: runId,
  };
}

/**
 * Reports whether a step receives the invocation's trailing arguments.
 *
 * An opaque step is a leaf tool, and nmr hands it the arguments rather than judging whether it can use them.
 * Only a composite declares, and only against its default of receiving them.
 */
function acceptsArguments(step: Step): boolean {
  return step.kind === 'opaque' || step.shouldDeclineArguments !== true;
}

/**
 * Binds the invocation's trailing arguments to every step that accepts them, leaving a declining step to run
 * unnarrowed, and refuses the invocation where no step accepts them at all.
 *
 * The refusal and the binding read `acceptsArguments` together, so what nmr rejects is exactly what would have left
 * the arguments nowhere to land. Splitting the two is what would let them drift.
 *
 * A hook is out of reach here rather than excluded: `wrapWithHooks` wraps what this returns, so a `:pre` or
 * `:post` step is composed after the arguments have already been placed.
 */
function bindPassthrough(
  steps: readonly Step[],
  passthrough: readonly string[],
  command: string,
): { ok: true; steps: readonly Step[] } | { ok: false; error: string } {
  if (passthrough.length === 0) {
    return { ok: true, steps };
  }
  if (!steps.some(acceptsArguments)) {
    return { ok: false, error: formatUnroutableArgumentsError(command) };
  }

  const boundSteps: readonly Step[] = steps.map((step) => {
    if (!acceptsArguments(step)) {
      return step;
    }
    return step.kind === 'structural'
      ? { ...step, argv: [...step.argv, ...passthrough] }
      : { kind: 'opaque', command: `${step.command} ${passthrough.map(shellQuote).join(' ')}` };
  });

  return { ok: true, steps: boundSteps };
}

/** Returns the line an invocation gets when its arguments have nowhere to land. */
function formatUnroutableArgumentsError(command: string): string {
  return (
    `\`${command}\` takes no trailing arguments: every step of its chain declines them. ` +
    'Running it unnarrowed is not what the arguments asked for, so nothing ran.'
  );
}

/**
 * Composes the delegation an `-F` or `-R` calls for, or `undefined` where the invocation runs here.
 *
 * One structural step, so the pattern a `-F` carries and the arguments passed on stay argv tokens rather than
 * text spliced into a shell string, and so the nmr processes underneath write where this one writes although
 * the binary spawned is `pnpm`. A flag of nmr's own precedes the command name, where the nmr underneath reads
 * it as its own rather than passing it on to the command.
 *
 * A `--log` fan-out surveys the scopes selected, so a scope with nothing to show is a gap in the survey rather
 * than a failure of it, however that scope was selected.
 */
function composeDelegation(options: {
  childEnv: NodeJS.ProcessEnv;
  command: string;
  parsedArgs: ParsedArgs;
}): { env: NodeJS.ProcessEnv; step: Extract<Step, { kind: 'structural' }> } | undefined {
  const { childEnv, command, parsedArgs } = options;

  let scope: string[] | undefined;
  let shouldRunIfPresent = parsedArgs.shouldPrintLog;
  if (parsedArgs.filter) {
    scope = ['--filter', parsedArgs.filter];
  } else if (parsedArgs.recursive) {
    scope = ['--recursive'];
    shouldRunIfPresent = true;
  }
  if (scope === undefined) {
    return undefined;
  }

  const flags = parsedArgs.shouldPrintLog ? ['--log'] : [];

  return {
    env: shouldRunIfPresent ? { ...childEnv, [RUN_IF_PRESENT_ENV_VAR]: '1' } : childEnv,
    step: {
      kind: 'structural',
      argv: ['pnpm', ...scope, 'exec', 'nmr', ...flags, command, ...parsedArgs.passthrough],
    },
  };
}

/**
 * Composes the retention a pass carries, or `undefined` when the run left nothing to replay: a command whose
 * streams were handed to a terminal retained no copy, one that printed nothing yields no excerpt, and a
 * composite whose constituents recorded none has nothing to assemble.
 *
 * A leaf hands back what its own command wrote, and the excerpt is drawn from stdout, falling back to stderr
 * only where stdout retained nothing, which is where every command the gate covers writes its substance. A
 * composite hands back nothing of its own -- `expandScript` gives a step list that is either one opaque step
 * or all structural ones -- so its retention is the assembly of what its constituents recorded.
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

/**
 * Returns what a crossing's line names: the declaration site it leads with, and the edit that resolves it.
 *
 * The remedy follows from the origin rather than naming one tier for every case, so the switch is exhaustive:
 * an origin kind added without a remedy fails to compile.
 */
function describeCrossingRemedy(options: {
  crossingStep: string;
  isWorkspaceRoot: boolean;
  monorepoRoot: string;
  origin: DiagnosticOrigin;
  registry: ScriptRegistry;
}): { remedy: string; subject: string } {
  const { crossingStep, isWorkspaceRoot, monorepoRoot, origin, registry } = options;
  const configSite = path.relative(monorepoRoot, resolveConfigPath(monorepoRoot));

  switch (origin.tier) {
    case 'default':
      return {
        remedy: 'A built-in default reaching nmr through a shell is an nmr defect: please report it.',
        subject: `nmr built-in \`${origin.key}\``,
      };
    case 'config':
      return {
        remedy: `Write the nmr steps as a step list, and move any others to ${describeStepDestination(origin.key)}.`,
        subject: `${configSite}: \`${origin.field}.${origin.key}\``,
      };
    case 'package':
      return {
        remedy: formatPackageRemedy({ configSite, crossingStep, isWorkspaceRoot, key: origin.key, registry }),
        subject: `${path.relative(monorepoRoot, origin.file)}: \`scripts.${origin.key}\``,
      };
    default: {
      const unhandledOrigin: never = origin;
      throw new Error(`Unhandled script origin: ${JSON.stringify(unhandledOrigin)}`);
    }
  }
}

/**
 * Names where the steps standing beside an entry's nmr invocations belong.
 *
 * A hook takes the other answer: nmr wraps a `:pre` or `:post` script in no hooks of its own, so naming one
 * below it would name a script nmr never runs. Its own steps become a script the step list names instead.
 */
function describeStepDestination(key: string): string {
  if (isHookName(key)) {
    return 'a script of their own that the step list names, because a hook has no `:pre` or `:post` of its own';
  }

  return `a \`${key}:pre\` or \`${key}:post\` script`;
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
function describeOrigin(origin: ScriptOrigin, config: NmrConfig, shouldUseRoot: boolean): DiagnosticOrigin {
  if (origin.tier === 'package') {
    return origin;
  }

  const field = shouldUseRoot ? 'rootScripts' : 'workspaceScripts';
  const configScripts = config[field];

  return configScripts !== undefined && Object.hasOwn(configScripts, origin.key)
    ? { tier: 'config', field, key: origin.key }
    : { tier: 'default', key: origin.key };
}

/**
 * Renders a declaration's text as the file holds it, so a value written across lines quotes on one line.
 *
 * A diagnostic names a declaration the reader has to edit, and a JSON string holds an escape sequence where a
 * shell would read a control character. Rendering the escape is what keeps the line one line, and it is the
 * text the reader will search the file for.
 *
 * Renders at the quoting site alone. `formatPackageRemedy` decides its delete-the-entry branch by comparing a
 * rendered chain against the entry, and an escape applied ahead of that comparison would defeat it.
 */
function escapeControlCharacters(text: string): string {
  let escapedText = text;
  for (const [char, escape] of NAMED_ESCAPES) {
    escapedText = escapedText.split(char).join(escape);
  }

  return escapedText;
}

/**
 * Renders the line reporting a step that reaches nmr through a shell, which puts the nested run's output on the
 * channels a tool's takes: withheld as one block under `quiet`, and relayed through this process under `full`.
 *
 * Leads with the declaration site, so each report a recursive run emits names the file it is an edit to, and
 * derives the remedy from that site rather than naming one tier for every case.
 */
function formatNmrCrossingWarning(options: {
  crossingStep: string;
  isWorkspaceRoot: boolean;
  monorepoRoot: string;
  origin: DiagnosticOrigin;
  registry: ScriptRegistry;
  style: OutputStyle;
}): string {
  const { remedy, subject } = describeCrossingRemedy(options);

  return (
    `${STATUS_GLYPHS[options.style].warning.text} ${subject} reaches nmr through a shell ` +
    `(\`${escapeControlCharacters(options.crossingStep)}\`), ${CROSSING_CONSEQUENCE} ${remedy}`
  );
}

/**
 * Returns the line announcing that a `package.json` script is standing in for a built-in, or `undefined` when
 * none is due. Only a script replacing a name the registry already defines is worth announcing; an ordinary
 * tier-3 entry that happens to resolve is not standing in for anything.
 */
function formatOverrideNotice(
  resolvedScript: ResolvedScript,
  registry: ScriptRegistry,
  command: string,
  anchorDir: string,
  quiet: boolean,
  style: OutputStyle,
): string | undefined {
  const registryEntry = Object.hasOwn(registry, command) ? registry[command] : undefined;
  if (quiet || resolvedScript.origin.tier !== 'package' || registryEntry === undefined) {
    return undefined;
  }

  const notice = `${path.basename(anchorDir)}: Using override script: ${renderChain(resolvedScript.steps)}`;

  return `${formatGlyphLine(NMR_GLYPHS, style, 'package', notice)}\n`;
}

/**
 * Returns the edit that resolves a self-referential entry.
 *
 * A hook takes an edit of its own: nmr wraps a `:pre` or `:post` script in no hooks, so there is no script
 * below it to move steps to. What has to go there is the re-invocation, which leaves the steps standing beside
 * it as the ones the hook runs.
 */
function formatSelfReferenceRemedy(options: {
  command: string;
  isWorkspaceRoot: boolean;
  monorepoRoot: string;
  registry: ScriptRegistry;
  script: string;
}): string {
  const { command, isWorkspaceRoot, monorepoRoot, registry, script } = options;

  if (isHookName(command)) {
    return `Delete the re-invocation: \`${command}\` runs the steps standing beside it.`;
  }

  const configSite = path.relative(monorepoRoot, resolveConfigPath(monorepoRoot));

  return formatPackageRemedy({ configSite, crossingStep: script, isWorkspaceRoot, key: command, registry });
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
  crossingStep: string;
  isWorkspaceRoot: boolean;
  key: string;
  registry: ScriptRegistry;
}): string {
  const { configSite, crossingStep, isWorkspaceRoot, key, registry } = options;
  const registryEntry = Object.hasOwn(registry, key) ? registry[key] : undefined;

  if (registryEntry === undefined) {
    return (
      `A \`package.json\` script holds no step list: define \`${key}\` in \`${configSite}\` and move the ` +
      `package-specific steps to ${describeStepDestination(key)}.`
    );
  }

  const registryChain = renderChain(expandScript(registryEntry, isWorkspaceRoot));
  if (registryChain === crossingStep) {
    return `Delete the entry: nmr's own \`${key}\` already runs \`${escapeControlCharacters(registryChain)}\`.`;
  }

  return `Delete the entry and move the steps it adds to ${describeStepDestination(key)}.`;
}

/**
 * Returns what is wrong with a parsed invocation, or `undefined` when nothing is.
 *
 * `--log` names what to print rather than what to run, so an invocation carrying it and no command has asked
 * for nothing; the help text answers a different question and is not a stand-in for the flag's own grammar.
 */
function findArgError(parsed: ParsedArgs): string | undefined {
  if (parsed.shouldPrintLog && parsed.command === undefined && !parsed.shouldShowHelp && !parsed.shouldShowVersion) {
    return '--log requires a command name: `nmr --log <command>`';
  }

  return undefined;
}

/**
 * Returns the line refusing a delegation that would select no scope, or `undefined` where it selects at least
 * one.
 *
 * A selection of nothing runs nothing and reports nothing, which reads exactly like a run that passed. pnpm
 * carries neither signal -- its exit code is 0 either way, and the `Scope: 0 of N` line it prints under `run`
 * is absent under the `exec` a delegation composes -- so the refusal is nmr's to make, ahead of the delegate.
 *
 * A filter is put to pnpm, which owns what the pattern means, and `selection` is pnpm's answer; a `-R` is not,
 * and carries none, since `pnpm --recursive` leaves the root project out and a workspace declaring no package is
 * its only empty selection.
 */
function findEmptySelectionRefusal(options: {
  context: ResolvedContext;
  parsedArgs: ParsedArgs;
  selection: FilterSelection | undefined;
}): string | undefined {
  const { context, parsedArgs, selection } = options;

  const isPackageless = context.workspacePackageDirs.length === 0;

  if (parsedArgs.filter !== undefined) {
    if (selection !== 'empty') {
      return undefined;
    }
    // A workspace holding no package would have refused whatever the pattern was, so the pattern-shape rules
    // below answer the wrong question there: no name rule and no near-name search repairs a workspace.
    if (isPackageless) {
      return `${formatFilterRejection(parsedArgs.filter)} ${describeEmptyWorkspace(context.monorepoRoot)}`;
    }
    return formatEmptyFilterError(parsedArgs.filter, readWorkspacePackageNames(context.workspacePackageDirs));
  }

  return isPackageless ? `${RECURSIVE_REJECTION} ${describeEmptyWorkspace(context.monorepoRoot)}` : undefined;
}

/**
 * Returns the line a filter selecting no workspace gets, naming the pattern and what it is matched against.
 *
 * The rule is stated because the mistake it catches is passing a directory name: a package's directory and its
 * manifest `name` differ often enough that the pattern looks right to the reader who wrote it.
 *
 * Three other forms state a rule of their own: a directory pattern, an exclusion, and a changed-since
 * selector. None of them carries a name, so none of them gets a name suggested back.
 */
function formatEmptyFilterError(pattern: string, names: readonly string[]): string {
  const rejection = formatFilterRejection(pattern);

  if (pattern.startsWith('!')) {
    return `${rejection} A pattern beginning with \`!\` excludes what it matches, and this one leaves no package standing.`;
  }

  if (pattern.includes('[')) {
    return `${rejection} A pattern carrying \`[<ref>]\` selects the packages changed since a git ref, and none has changed.`;
  }

  if (pattern.startsWith('.') || pattern.startsWith('/') || pattern.startsWith('{')) {
    return (
      `${rejection} ` +
      'A pattern written `./dir`, `/dir`, or `{dir}` selects the packages under a directory, ' +
      'and no package sits under this one.'
    );
  }

  return (
    `${rejection} A pattern matches a package's manifest \`name\`, ` +
    `not its directory name.${suggestWorkspaceNames(pattern, names)}`
  );
}

/**
 * Returns the sentences naming which of the three conditions left the workspace holding no package, and the
 * remedy for that one. Every one of them quotes the `packages` list the manifest declares.
 *
 * The `package.json` requirement is stated under `no-manifest` because it is a divergence from pnpm, which
 * recognizes two further manifests, and the reader of a workspace that pnpm resolves has no way to infer it.
 */
function describeEmptyWorkspace(monorepoRoot: string): string {
  const { cause, patterns } = diagnoseEmptyWorkspace(monorepoRoot);
  const declaredClause = describeDeclaredPatterns(patterns);

  switch (cause) {
    case 'all-excluded':
      return (
        `pnpm-workspace.yaml ${declaredClause}, whose \`!\` entries exclude every directory matched by the positive ` +
        'patterns. Drop or narrow the exclusion.'
      );
    case 'no-manifest':
      return (
        `pnpm-workspace.yaml ${declaredClause}, and the matcher found no directory holding a \`package.json\`. ` +
        'nmr counts a directory as a package only where it holds `package.json`; unlike pnpm, it recognizes ' +
        'neither `package.yaml` nor `package.json5`. Add a `package.json` to the directory that should be a ' +
        'package, or declare a pattern reaching a directory that holds one.'
      );
    case 'no-pattern':
      return (
        `pnpm-workspace.yaml ${declaredClause}, so no pattern reaches the matcher. Declare a positive pattern such ` +
        'as `packages/*`, and quote any `!` entry, which YAML reads as a tag rather than a string where it ' +
        'stands bare.'
      );
    default: {
      const unhandledCause: never = cause;
      throw new Error(`Unhandled empty-workspace cause: ${String(unhandledCause)}`);
    }
  }
}

/**
 * Returns the clause naming what the manifest's `packages` key declares, which every empty-workspace message
 * leads with.
 *
 * An entry the parser left empty is what an unquoted `!pkg` becomes, and the matcher drops it. Naming it as an
 * empty entry is what a reader can act on: quoting it renders an empty pair of backticks, and it does so in the
 * one case the `no-pattern` remedy is written for.
 */
function describeDeclaredPatterns(patterns: readonly string[]): string {
  const quotablePatterns = patterns.filter((pattern) => pattern.trim() !== '');
  const emptiedCount = patterns.length - quotablePatterns.length;

  if (emptiedCount === 0) {
    return patterns.length === 0 ? 'declares no `packages` list' : `declares ${renderQuotedList(patterns)}`;
  }

  const emptiedClause = `${emptiedCount} ${emptiedCount === 1 ? 'entry' : 'entries'} that YAML left empty`;

  return quotablePatterns.length === 0
    ? `declares ${emptiedClause}`
    : `declares ${renderQuotedList(quotablePatterns)}, beside ${emptiedClause}`;
}

/** Returns the rejection a filter leads its line with, naming the pattern that selected nothing. */
function formatFilterRejection(pattern: string): string {
  return `-F/--filter matched no workspace: \`${pattern}\`.`;
}

/**
 * Returns the sentence pointing a rejected pattern at the names it could have named, or nothing where the
 * workspace declares none.
 *
 * A containing name comes ahead of the nearest one: a directory name commonly stands for a longer manifest
 * name, and `secrets` sits nine edits from `@scope/toolbelt.secrets`, past any ceiling that would still reject
 * a name the user never meant.
 */
function suggestWorkspaceNames(pattern: string, names: readonly string[]): string {
  if (names.length === 0) {
    return '';
  }

  const containingNames = names.filter((name) => name.toLowerCase().includes(pattern.toLowerCase()));
  if (containingNames.length > 0) {
    return ` Did you mean ${renderQuotedList(containingNames)}?`;
  }

  const closestName = findClosestName(pattern, names);
  if (closestName !== undefined) {
    return ` Did you mean \`${closestName}\`?`;
  }

  return ` The workspace declares ${renderQuotedList(names)}.`;
}

/** Renders a list of items for a diagnostic, backticked and capped so a long one does not fill the terminal. */
function renderQuotedList(items: readonly string[]): string {
  const shownItems = items
    .slice(0, LIST_CEILING)
    .map((item) => `\`${item}\``)
    .join(', ');
  const remainder = items.length - LIST_CEILING;

  return remainder > 0 ? `${shownItems}, and ${remainder} more` : shownItems;
}

/**
 * Returns why a resolved command runs nothing, or `undefined` when there is something to run. A command that
 * ran nothing is not a command that passed, and the two exit alike, so the reason is what a verdict spends on
 * telling them apart.
 *
 * A chain the package-free filter emptied renders exactly as an `""` override does, so the caller states which
 * it was rather than leaving the reason to be read back out of the string.
 */
function findNoOpReason(resolvedCommand: string, isEmptiedByWorkspace: boolean): NoOpReason | undefined {
  if (isEmptiedByWorkspace) {
    return 'empty-workspace';
  }
  if (resolvedCommand === '') {
    return 'empty-override';
  }
  if (resolvedCommand === ':') {
    return 'noop-override';
  }
  return undefined;
}

/**
 * Rejects a `package.json` entry that chains steps onto a re-invocation of its own command, which resolution
 * discards, leaving those steps to run nowhere. Accepts every other entry in silence.
 *
 * Ahead of resolution rather than after it, so a command the registry does not define reports the declaration
 * that names it rather than the name it could not find. A `--log` rejects none, running nothing whose steps
 * could go missing.
 *
 * Raised as a `UserError`, the channel a malformed `scripts` value in the same file already takes. The remedy
 * is the one a crossing names, the entry having to go either way; the consequence is not, this entry never
 * running at all.
 */
function assertNoSelfReference(options: {
  anchorDir: string;
  command: string;
  isReading: boolean;
  isWorkspaceRoot: boolean;
  monorepoRoot: string;
  registry: ScriptRegistry;
}): void {
  const { anchorDir, command, isReading, isWorkspaceRoot, monorepoRoot, registry } = options;

  if (isReading) {
    return;
  }

  const script = findChainedSelfReference(anchorDir, command);
  if (script === undefined) {
    return;
  }

  const remedy = formatSelfReferenceRemedy({ command, isWorkspaceRoot, monorepoRoot, registry, script });
  const site = path.relative(monorepoRoot, resolvePackageJsonPath(anchorDir));

  throw new UserError(
    `${site}: \`scripts.${command}\` re-invokes \`nmr ${command}\` (\`${escapeControlCharacters(script)}\`), ` +
      `so nmr cannot run the steps it chains. ${remedy}`,
  );
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
  isWorkspaceRoot: boolean,
): boolean {
  // A rejected entry resolves to nothing wherever the registry defines no such hook, and dropping the hook
  // would drop the report with it. Wrapping it is what puts the rejection in front of the hook's own process.
  if (findChainedSelfReference(anchorDir, hookName) !== undefined) {
    return true;
  }

  const resolvedScript = resolveScript(hookName, registry, anchorDir, isWorkspaceRoot);
  if (!resolvedScript) return false;

  const chain = renderChain(resolvedScript.steps);
  return chain !== '' && chain !== ':';
}

/**
 * Returns the age and saving a recalled pass reports when a recorded pass covers this invocation, or
 * `undefined` when the command has to run. A key match alone is not a pass: the build output the key says
 * nothing about has to still be on disk, and the run that follows a missing-output miss is what restores it.
 *
 * The excerpts a skip replays come back only where the retention key matches too. A recording made under
 * another presentation environment is still a pass, and is not this environment's output.
 *
 * The entry comes back with them, so the caller can certify what it is about to replay.
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
}): Promise<{ ageMs: number; entry: CheckCacheEntry; replay?: ReplayLine[]; savedMs: number } | undefined> {
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

  const [missingPackage] = buildOutput.missingPackages;
  if (missingPackage !== undefined) {
    writeDebugNote(`running ${command}: ${missingPackage} has no build output`, env, stderr);
    return undefined;
  }

  // Presence alone would let a `dist` compiled from another tree pass for this one: git ignores build output,
  // so restoring a tree restores none of it, and the run that would have rebuilt it is the one being skipped.
  const stalePackage = findStaleBuildOutput(entry.buildDigests, buildOutput.digests);
  if (stalePackage !== undefined) {
    writeDebugNote(`running ${command}: ${stalePackage}'s build output came from a different tree`, env, stderr);
    return undefined;
  }

  return {
    ageMs: Math.max(0, Date.now() - Date.parse(entry.recordedAt)),
    entry,
    savedMs: entry.durationMs,
    // Replayed only where the recording describes this environment's output; otherwise the verdict prints alone.
    ...(entry.retention?.key === options.retentionKey && { replay: entry.retention.replay }),
  };
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
  style: OutputStyle;
}): TreeSnapshot | undefined {
  const { command, config, env, monorepoRoot, passthrough, stderr, style } = options;

  if (!isCacheableCommand(config.checkCache, command)) {
    return undefined;
  }

  // A `--no-cache` past the command name is an argument to that command, and is passed on as one. Saying so is
  // all that stands between a developer and a bypass they believe happened.
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

function parseArgs(args: string[]): ParseResult {
  const parsedArgs: ParsedArgs = {
    isWorkspaceRoot: false,
    quiet: false,
    recursive: false,
    shouldBypassCache: false,
    shouldEmitJson: false,
    shouldPrintLog: false,
    shouldShowHelp: false,
    shouldShowVersion: false,
    passthrough: [],
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === undefined) break;

    if (arg === '-F' || arg === '--filter') {
      i++;
      const filterValue = args[i];
      // An empty pattern is rejected with a missing one: composition reads a filter for its truth, so an
      // empty one would run the command unfiltered rather than in the scopes the invocation asked for.
      if (!filterValue) {
        return { ok: false, error: '-F/--filter requires a pattern argument' };
      }
      parsedArgs.filter = filterValue;
      i++;
      continue;
    }

    const booleanFlag = BOOLEAN_FLAGS.get(arg);
    if (booleanFlag !== undefined) {
      parsedArgs[booleanFlag] = true;
      i++;
      continue;
    }

    const styleArgument = readOutputStyleArgument(args, i);
    if (styleArgument !== undefined) {
      if (!styleArgument.ok) {
        return styleArgument;
      }
      parsedArgs.outputStyle = styleArgument.value;
      i += styleArgument.consumed;
      continue;
    }

    // First non-flag argument is the command; rest is passthrough
    parsedArgs.command = arg;
    parsedArgs.passthrough = args.slice(i + 1);
    break;
  }

  const error = findArgError(parsedArgs);

  return error === undefined ? { ok: true, parsed: parsedArgs } : { ok: false, error };
}

/**
 * Prints what the current scope has recorded for one command, and reports what it exits with.
 *
 * A refusal ends the invocation non-zero, which is what tells a caller that nothing on stdout is the run it
 * asked for. Under a delegate it does not: a fan-out asks every selected scope, and a scope that never ran the
 * command is a gap in a survey rather than a failure of one, so bailing there would hide every scope that has
 * something to show.
 */
async function reportRecording(options: {
  anchorDir: string;
  command: string;
  commandString: string;
  config: NmrConfig;
  env: NodeJS.ProcessEnv;
  key: string | undefined;
  monorepoRoot: string;
  scope: string;
  snapshot: TreeSnapshot | undefined;
  stderr: Writable;
  stdout: Writable;
  styles: StreamStyles;
}): Promise<RunCliResult> {
  const { command, config, scope, styles } = options;

  const lookup = await resolveRecording({
    anchorDir: options.anchorDir,
    command,
    currentIdentity: {
      commandString: options.commandString,
      nmrVersion: VERSION,
      nodeVersion: CURRENT_RUNTIME.nodeVersion,
      treeHash: options.snapshot?.hash,
    },
    isCacheable: isCacheableCommand(config.checkCache, command),
    key: options.key,
    monorepoRoot: options.monorepoRoot,
  });

  if (!lookup.ok) {
    options.stderr.write(`${renderRefusal({ command, refusal: lookup.refusal, scope, style: styles.stderr })}\n`);
    return { exitCode: options.env[RUN_IF_PRESENT_ENV_VAR] === '1' ? 0 : 1 };
  }

  options.stdout.write(renderRecording({ command, recording: lookup.recording, scope, style: styles.stdout }));

  return { exitCode: 0 };
}

/**
 * Reads everything that decides how a run presents itself: the two inherited variables, and the style each
 * output stream resolves to. Read together, so a run carrying two unreadable values is not fixed one release
 * at a time.
 *
 * The style is resolved here rather than beside its use, so that a value naming no style is rejected where an
 * unreadable variable is, which is ahead of `--version` and of the config load.
 */
function readPresentation(options: {
  env: NodeJS.ProcessEnv;
  flagValue: string | undefined;
  stderrIsTty: boolean;
  stdoutIsTty: boolean;
}): PresentationRead {
  const { env } = options;

  const verbosity = readVerbosityEnv(env);
  if (!verbosity.ok) {
    return verbosity;
  }

  const format = readReportFormatEnv(env);
  if (!format.ok) {
    return format;
  }

  const { invalid: invalidStyle, styles } = resolveOutputStyles(options);
  if (invalidStyle !== undefined) {
    return { ok: false, error: describeInvalidOutputStyle(invalidStyle) };
  }

  return { ok: true, format: format.format, styles, verbosity: verbosity.verbosity };
}

/**
 * Returns what `--output-style` at `index` names, or `undefined` where the argument is not the flag.
 *
 * Both spellings are read, so neither `--output-style plain` nor `--output-style=plain` is taken for the
 * command name. An empty value is rejected with a missing one: nmr-core reads `''` as absent, which would
 * leave the flag naming whatever the variable or detection chose rather than what the invocation asked for.
 * The value itself is left to the resolver, which rejects it in the words nmr's siblings use.
 */
function readOutputStyleArgument(args: string[], index: number): OutputStyleArgumentRead | undefined {
  const arg = args[index] ?? '';
  const assignment = arg.startsWith(`${OUTPUT_STYLE_FLAG}=`) ? arg.slice(OUTPUT_STYLE_FLAG.length + 1) : undefined;
  if (arg !== OUTPUT_STYLE_FLAG && assignment === undefined) {
    return undefined;
  }

  const value = assignment ?? args[index + 1];
  if (!value) {
    return { ok: false, error: `${OUTPUT_STYLE_FLAG} requires a value argument: auto, plain, or rich` };
  }

  return { ok: true, value, consumed: assignment === undefined ? 2 : 1 };
}

/**
 * Returns the steps a resolved script runs at this scope, and whether dropping one left the chain empty.
 *
 * A `-R` step in a workspace that holds no package has no scope to reach, and nmr composed it rather than the
 * caller, so it is dropped rather than refused. A chain that was already empty was emptied by an override, which
 * the verdict reports as one, so the two are distinguished here rather than read back out of the rendering.
 */
function readRunnableSteps(
  resolvedScript: ResolvedScript,
  workspacePackageDirs: readonly string[],
): { isEmptiedByWorkspace: boolean; steps: readonly Step[] } {
  if (workspacePackageDirs.length > 0) {
    return { isEmptiedByWorkspace: false, steps: resolvedScript.steps };
  }

  const steps = dropRecursiveSteps(resolvedScript.steps);

  return { isEmptiedByWorkspace: steps.length === 0 && resolvedScript.steps.length > 0, steps };
}

/**
 * Reports a step that reaches nmr through a shell, where the resolved script holds one.
 *
 * Ahead of the gate, so a command that usually skips still reports the boundary it carries. A `--log` reports
 * none, running nothing that could cross. Reads the resolved steps rather than the full chain: the line names
 * a declaration to edit, and a hook, a passthrough, and a `devBin` substitution are none.
 */
function reportNmrCrossing(options: {
  config: NmrConfig;
  isReading: boolean;
  isWorkspaceRoot: boolean;
  monorepoRoot: string;
  registry: ScriptRegistry;
  resolvedScript: ResolvedScript;
  shouldUseRoot: boolean;
  stderr: Writable;
  style: OutputStyle;
}): void {
  const crossingStep = findNmrCrossing(options.resolvedScript.steps);
  if (options.isReading || crossingStep === undefined) {
    return;
  }

  const warning = formatNmrCrossingWarning({
    crossingStep,
    isWorkspaceRoot: options.isWorkspaceRoot,
    monorepoRoot: options.monorepoRoot,
    origin: describeOrigin(options.resolvedScript.origin, options.config, options.shouldUseRoot),
    registry: options.registry,
    style: options.style,
  });

  options.stderr.write(`${warning}\n`);
}

/**
 * Reports an invocation's verdict, unless the levels around it already report for it.
 *
 * A hook leaf reports none: it is not a command anyone asked for, but part of the chain the level that wrapped
 * it reports on, and a line here would say the same thing twice under a different name. A delegating
 * invocation reports none either, and needs no test here -- it returns before a verdict is composed, every
 * scope it fans out to reporting one of its own.
 */
function reportVerdict(verdict: Verdict, stdout: Writable, format: ReportFormat, style: OutputStyle): void {
  if (isHookName(verdict.command)) {
    return;
  }
  writeVerdict(verdict, stdout, format, style);
}

/**
 * Resolves how loudly this run reports the output of the commands it runs.
 *
 * A machine-readable run reports on stdout and nothing else may, so it withholds that output whatever the
 * loudness ladder would have resolved to. A failure still surrenders it on stderr, as under any quiet run: the
 * two leave the child on the same channels, so a machine-readable run and a quiet one share a retention key.
 */
function resolveReportingVerbosity(options: ResolveVerbosityOptions & { format: ReportFormat }): CommandVerbosity {
  const { format, ...ladder } = options;

  return format === 'json' ? 'quiet' : resolveVerbosity(ladder);
}

/**
 * Records a pass, unless what the check was asked about moved while it ran: a rewritten file describes a tree
 * that no longer exists, and build output that changed leaves no answer to which output the pass was earned
 * over. Recording either would certify content nothing ran against. The recorded key is the one the snapshot
 * produced, so every entry from one invocation refers to one tree.
 *
 * A cache that cannot be written is not worth failing a green run over, so that failure goes to the debug note.
 *
 * The retention a skip replays is composed here for the same reason and after the same tests: a pass nothing
 * recorded must leave behind no excerpt claiming it did. A composite's assembly is built here rather than when
 * it skips, so every excerpt in it was certified during the run whose pass carries it.
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
  retainedOutput: RetainedOutput | undefined;
  ownSteps: readonly Step[];
  retentionKey: string;
  runId: string;
  snapshot: TreeSnapshot;
  stderr: Writable;
}): Promise<void> {
  const { anchorDir, command, env, monorepoRoot, snapshot, stderr } = options;

  // Hashed afresh rather than inherited: an inherited snapshot is the observation this is meant to re-test.
  const currentRead = resolveTreeSnapshot({ monorepoRoot, env: {} });
  if (!currentRead.ok) {
    writeDebugNote(`not recording ${command}: ${currentRead.reason}`, env, stderr);
    return;
  }
  if (currentRead.snapshot.hash !== snapshot.hash) {
    writeDebugNote(`not recording ${command}: the tree changed while it ran`, env, stderr);
    return;
  }

  // Read after the chain, so the digests describe the output the pass was actually earned over. A pass over a
  // repository still missing output describes a state no later run should be held to, so it is not recorded.
  const output = await readBuildOutputState(monorepoRoot, options.config);
  const [missingPackage] = output.missingPackages;
  if (missingPackage !== undefined) {
    writeDebugNote(`not recording ${command}: ${missingPackage} has no build output`, env, stderr);
    return;
  }

  // The check read one output and the entry would record the other, so neither describes the pass. A chain that
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
    treeHash: snapshot.hash,
  });

  const ref = { anchorDir, command, monorepoRoot };
  const transcript = options.retainedOutput === undefined ? undefined : composeTranscript(options.retainedOutput);

  try {
    // Ahead of the entry, and withdrawn again where the entry fails to land, so a reader never dates one
    // run's bytes by another run's instant.
    await recordTranscript(ref, transcript);
    await writeCheckCacheEntry({
      ...ref,
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
        ...(retention !== undefined && { retention }),
      },
    });
  } catch (error: unknown) {
    try {
      await recordTranscript(ref, undefined);
    } catch {
      // The entry's own failure is what the caller needs to hear about.
    }
    writeDebugNote(`could not record ${command}: ${describeError(error)}`, env, stderr);
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
 * Runs a `-F` or `-R` delegation, or refuses it where it would select no scope.
 *
 * The refusal precedes the delegate rather than reading its outcome, since a delegation that selected nothing
 * has already run to completion, reporting nothing and exiting 0, by the time nmr sees it.
 *
 * A `-R` delegation gives its packages no stdin, as does a filter that pnpm lists as several packages. pnpm 12
 * starts each package of a concurrent `exec` in a background process group, which the system stops when it reads
 * from the terminal or changes its mode, so a command such as `next build` would hang the run. pnpm keeps a serial
 * run in the foreground, which nmr cannot observe; `-R` itself and a filter's package count stand in for it, and a
 * `-R` or a dependency-chain filter that pnpm runs serially loses its input as well. A filter whose selection pnpm
 * did not report keeps nmr's stdin.
 */
async function runDelegation(options: {
  context: ResolvedContext;
  delegation: { env: NodeJS.ProcessEnv; step: Extract<Step, { kind: 'structural' }> };
  parsedArgs: ParsedArgs;
  runOptions: RunStepsOptions;
  stderr: Writable;
}): Promise<RunCliResult> {
  const { context, delegation, parsedArgs, runOptions, stderr } = options;

  const selection =
    parsedArgs.filter === undefined ? undefined : readFilterSelection(parsedArgs.filter, context.monorepoRoot);

  const refusal = findEmptySelectionRefusal({ context, parsedArgs, selection });
  if (refusal !== undefined) {
    reportError(refusal, stderr);
    return { exitCode: 1 };
  }

  const shouldWithholdInput = parsedArgs.filter === undefined || selection === 'multiple';
  const step = shouldWithholdInput ? { ...delegation.step, shouldWithholdInput } : delegation.step;

  return runSteps([step], context.monorepoRoot, { ...runOptions, env: delegation.env });
}

/**
 * Runs the resolved steps behind the check-result cache: skips them when a recorded pass covers this
 * invocation, and records a pass when one is earned. Returns the exit code and the outcome a verdict reports,
 * either way.
 *
 * The override notice waits until the command is going to run, because naming the script that stands in for a
 * built-in says nothing useful about an invocation that skipped it.
 *
 * Two step lists: `steps` is the chain that runs, the hooks wrapped around the command included, and
 * `ownSteps` is the command's alone, which is what a composite's assembly reads. A hook contributes nothing to
 * what a skip replays, as it contributes nothing to a leaf's excerpt.
 */
async function runGated(options: {
  anchorDir: string;
  command: string;
  commandString: string;
  config: NmrConfig;
  env: NodeJS.ProcessEnv;
  key: string | undefined;
  monorepoRoot: string;
  overrideNotice: string | undefined;
  ownSteps: readonly Step[];
  runId: string;
  runOptions: RunStepsOptions;
  shouldBypassCache: boolean;
  snapshot: TreeSnapshot | undefined;
  steps: readonly Step[];
  stderr: Writable;
  stdout: Writable;
}): Promise<{ exitCode: number; outcome: VerdictOutcome }> {
  const { anchorDir, command, commandString, env, key, monorepoRoot, snapshot, stderr, stdout } = options;

  // The build output is read before the run, so a pass can be held to the output the run actually saw. One
  // reading serves the lookup and the recording alike, and `--no-cache` bypasses only the former.
  // The channels an opaque step of this run would hand its child, read from the same `resolveChannel` the
  // runner calls, so the retention key and the run cannot disagree about what the child saw.
  const quiet = options.runOptions.quiet === true;
  const gate =
    key !== undefined && snapshot !== undefined
      ? {
          buildOutputBefore: await readBuildOutputState(monorepoRoot, options.config),
          key,
          retentionKey: computeRetentionKey({
            channels: { stderr: resolveChannel(stderr, quiet), stdout: resolveChannel(stdout, quiet) },
            env,
            passKey: key,
          }),
          snapshot,
        }
      : undefined;

  if (gate !== undefined && !options.shouldBypassCache) {
    const recalledPass = await lookUpRecordedPass({
      anchorDir,
      buildOutput: gate.buildOutputBefore,
      command,
      env,
      key: gate.key,
      monorepoRoot,
      retentionKey: gate.retentionKey,
      stderr,
    });
    if (recalledPass !== undefined) {
      const { entry, ...recall } = recalledPass;
      // An excerpt this run declined to replay is one it has not certified, and vouching for it here would put
      // another environment's output into the assembly a composite above this one records.
      if (recall.replay !== undefined) {
        await certifyRetention({ anchorDir, command, entry, env, monorepoRoot, runId: options.runId, stderr });
      }

      return { exitCode: 0, outcome: { outcome: 'recalled', ...recall } };
    }
  }

  if (options.overrideNotice !== undefined) {
    stdout.write(options.overrideNotice);
  }

  const startedAt = Date.now();
  const { exitCode, retainedOutput } = await runSteps(options.steps, anchorDir, options.runOptions);
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
      ownSteps: options.ownSteps,
      retainedOutput,
      retentionKey: gate.retentionKey,
      runId: options.runId,
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
  isWorkspaceRoot: boolean,
): readonly Step[] {
  const steps: Step[] = [];

  if (hasRunnableHook(`${command}:pre`, registry, anchorDir, isWorkspaceRoot)) {
    steps.push(composeNmrStep(`${command}:pre`, isWorkspaceRoot));
  }
  steps.push(...mainSteps);
  if (hasRunnableHook(`${command}:post`, registry, anchorDir, isWorkspaceRoot)) {
    steps.push(composeNmrStep(`${command}:post`, isWorkspaceRoot));
  }

  return steps;
}

// endregion | Helpers
