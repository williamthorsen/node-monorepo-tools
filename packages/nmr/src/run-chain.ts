import path from 'node:path';

import { formatGlyphLine, type OutputStyle, reportError } from '@williamthorsen/nmr-core';

import type { TreeSnapshot } from './check-cache.ts';
import { resolveCacheKey } from './check-cache-gate.ts';
import { reportNmrCrossing } from './crossing-diagnostics.ts';
import { NMR_GLYPHS } from './glyphs.ts';
import { isHookName } from './helpers/hook-name.ts';
import { quoteForShell } from './helpers/quoteForShell.ts';
import { wrapWithHooks } from './hooks.ts';
import type { Invocation, PhaseResult, RunPlan } from './invocation.ts';
import { reportVerdict } from './presentation.ts';
import type { ScriptRegistry } from './resolve-scripts.ts';
import { applyDevBinToSteps, type ResolvedScript } from './resolver.ts';
import { dropRecursiveSteps, renderChain, type Step } from './steps.ts';
import type { NoOpReason } from './verdict.ts';

/**
 * Assembles the chain that a resolved script runs at this scope, the hooks wrapped around it included, and the key
 * under which a pass by that chain is recorded. Settles a no-op override and an argument that no step can take.
 */
export function assembleChain(options: {
  invocation: Invocation;
  registry: ScriptRegistry;
  resolvedScript: ResolvedScript;
  snapshot: TreeSnapshot | undefined;
}): PhaseResult<Pick<RunPlan, 'commandString' | 'key' | 'ownSteps' | 'steps'>> {
  const { invocation, registry, resolvedScript, snapshot } = options;
  const { anchorDir, command, context, env, parsedArgs, stderr, stdout, styles } = invocation;

  // Filter the steps before rendering the chain, which feeds both the cache key and the `--log` lookup, so that a
  // run and a reading of its recording agree about what the chain was.
  const { isEmptiedByWorkspace, steps: runnableSteps } = readRunnableSteps(
    resolvedScript,
    context.workspacePackageDirs,
  );

  const resolvedCommand = renderChain(runnableSteps);

  const noOpReason = findNoOpReason(resolvedCommand, isEmptiedByWorkspace);
  if (noOpReason !== undefined && !parsedArgs.shouldPrintLog) {
    reportVerdict(
      { command, scope: invocation.scope, outcome: 'no-op', reason: noOpReason },
      stdout,
      invocation.format,
      styles.stdout,
    );
    return { settled: true, result: { exitCode: 0 } };
  }

  const substitutedSteps = applyDevBinToSteps(runnableSteps, context.config.devBin, context.monorepoRoot);
  const substitutedCommand = renderChain(substitutedSteps);

  // Ahead of the recording branch as well as the run, so that `--log` and a run reject an unroutable argument the
  // same way.
  const bindResult = bindPassthrough(substitutedSteps, parsedArgs.passthrough, command);
  if (!bindResult.ok) {
    reportError(bindResult.error, stderr);
    return { settled: true, result: { exitCode: 1 } };
  }

  const mainSteps = bindResult.steps;

  // Hook recursion guard: a command ending in `:pre` or `:post` is a leaf operation, and is not itself
  // wrapped in further hook lookups.
  const isHookInvocation = isHookName(command);
  const fullSteps = isHookInvocation
    ? mainSteps
    : wrapWithHooks(command, mainSteps, registry, anchorDir, parsedArgs.isWorkspaceRoot);
  const fullCommand = renderChain(fullSteps);

  reportNmrCrossing({
    config: context.config,
    isReading: parsedArgs.shouldPrintLog,
    isWorkspaceRoot: parsedArgs.isWorkspaceRoot,
    monorepoRoot: context.monorepoRoot,
    registry,
    resolvedScript,
    shouldUseRoot: invocation.shouldUseRoot,
    stderr,
    style: styles.stderr,
  });

  // Compute the key only once the whole chain is known, so that it describes what would actually run: the hooks
  // wrapped around the command included.
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

  return { settled: false, value: { commandString: fullCommand, key, ownSteps: mainSteps, steps: fullSteps } };
}

/**
 * Returns the line announcing that a `package.json` script is standing in for a built-in, or `undefined` under
 * `quiet` or when none is due. Only a script replacing a name that the registry already defines is worth
 * announcing; an ordinary tier-3 entry that happens to resolve is not standing in for anything.
 */
export function formatOverrideNotice(
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

// region | Helpers

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
 * unnarrowed, and refuses the invocation when every step declines them.
 *
 * The refusal and the binding both read `acceptsArguments`, so nmr refuses exactly the invocations whose
 * arguments every step would decline.
 *
 * A hook never receives the arguments: `wrapWithHooks` adds the `:pre` and `:post` steps after binding.
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
      : { kind: 'opaque', command: `${step.command} ${passthrough.map(quoteForShell).join(' ')}` };
  });

  return { ok: true, steps: boundSteps };
}

/**
 * Returns why a resolved command runs nothing, or `undefined` when there is something to run. A command that
 * ran nothing exits as one that passed does, and the verdict reports the reason to tell them apart.
 *
 * A chain that `readRunnableSteps` emptied renders exactly as an `""` override does, so the caller states which
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

/** Returns the error for an invocation whose arguments every step declines. */
function formatUnroutableArgumentsError(command: string): string {
  return (
    `\`${command}\` does not take trailing arguments: every step of its chain declines them. ` +
    'Running it unnarrowed is not what the arguments asked for, so nothing ran.'
  );
}

/**
 * Returns the steps that a resolved script runs at this scope, and whether dropping one left the chain empty.
 *
 * A `-R` step in a workspace without a package does not have a scope to run in, and nmr composed it rather than
 * the caller, so it is dropped rather than refused. A chain that was already empty was emptied by an override,
 * which the verdict reports as one; this function distinguishes the two here rather than leaving them to be read
 * back out of the rendering.
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

// endregion | Helpers
