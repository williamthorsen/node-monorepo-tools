import path from 'node:path';
import type { Writable } from 'node:stream';

import { type OutputStyle, STATUS_GLYPHS } from '@williamthorsen/nmr-core';

import { resolveConfigPath } from './helpers/config-path.ts';
import { escapeControlCharacters } from './helpers/escapeControlCharacters.ts';
import { isHookName } from './helpers/hook-name.ts';
import { resolvePackageJsonPath } from './helpers/package-json.ts';
import { hasRunnableHook } from './hooks.ts';
import type { ScriptRegistry } from './resolve-scripts.ts';
import {
  expandScript,
  findChainedSelfReference,
  readPackageJsonScripts,
  type ResolvedScript,
  type ScriptOrigin,
} from './resolver.ts';
import { findNmrCrossing, readSoleNmrCommand, renderChain } from './steps.ts';
import type { NmrConfig } from './types.ts';
import { UserError } from './UserError.ts';

/** The consequence of a crossing, which every origin's line reports before naming its remedy. */
const CROSSING_CONSEQUENCE = "so nmr handles the nested run's output as a tool's.";

/**
 * Throws a `UserError` for a `package.json` entry that chains steps onto a re-invocation of its own command,
 * which resolution discards, leaving those steps to run nowhere. Accepts every other entry in silence.
 *
 * Runs ahead of resolution, so that a command that the registry does not define reports the declaration that
 * names it rather than the name that resolution could not find. A `--log` rejects none, running nothing whose
 * steps could go missing.
 */
export function assertNoSelfReference(options: {
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
      `so nmr cannot run the steps that it chains. ${remedy}`,
  );
}

/**
 * Reports a step that reaches nmr through a shell, when the resolved script contains one.
 *
 * Ahead of the gate, so that a command that usually skips still reports its crossing. A `--log` reports
 * none, running nothing that could cross. Reads the resolved steps rather than the full chain: the line names
 * a declaration to edit, and a hook, a passthrough, and a `devBin` substitution are none.
 */
export function reportNmrCrossing(options: {
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

// region | Helpers

/** A resolved script's origin, refined into the tier whose remedy the diagnostic names. */
type DiagnosticOrigin =
  | { tier: 'default'; key: string }
  | { tier: 'config'; field: 'rootScripts' | 'workspaceScripts'; key: string }
  | { tier: 'package'; file: string; key: string };

/**
 * Returns what a crossing's warning names: the declaration site with which it leads, and the edit that resolves
 * the crossing.
 *
 * The switch is exhaustive: an origin tier added without a remedy fails to compile.
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
        remedy:
          formatInlineRemedy({ crossingStep, file: origin.file, isWorkspaceRoot, key: origin.key, registry }) ??
          formatPackageRemedy({ configSite, crossingStep, isWorkspaceRoot, key: origin.key, registry }),
        subject: `${path.relative(monorepoRoot, origin.file)}: \`scripts.${origin.key}\``,
      };
    default: {
      const unhandledOrigin: never = origin;
      throw new Error(`Unhandled script origin: ${JSON.stringify(unhandledOrigin)}`);
    }
  }
}

/**
 * Refines a resolved script's origin into the tier that the diagnostic names.
 *
 * Resolution reports the defaults and the config as one tier, having received them merged. Separating them
 * needs the config, which this function receives and resolution does not.
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
 * Names where the steps next to an entry's nmr invocations belong.
 *
 * A hook takes the other answer: nmr does not wrap a `:pre` or `:post` script in hooks of its own, so naming one
 * below it would name a script that nmr never runs. Its own steps become a script that the step list names
 * instead.
 */
function describeStepDestination(key: string): string {
  if (isHookName(key)) {
    return 'a script of their own that the step list names, because a hook does not have a `:pre` or `:post` of its own';
  }

  return `a \`${key}:pre\` or \`${key}:post\` script`;
}

/**
 * Returns the edit that resolves a `package.json` entry whose whole value is `nmr <name>` naming a leaf script in the
 * same file, or `undefined` for any other entry.
 *
 * Inlining is exact only from the same file: A target that resolves from the registry would copy nmr's own command
 * text into the package. It is exact only without hooks, too: `nmr <name>` also runs `<name>:pre` and `<name>:post`,
 * which the inlined value would drop. The named script survives the edit when the registry also defines it, because
 * there it overrides nmr's own command.
 */
function formatInlineRemedy(options: {
  crossingStep: string;
  file: string;
  isWorkspaceRoot: boolean;
  key: string;
  registry: ScriptRegistry;
}): string | undefined {
  const { crossingStep, file, isWorkspaceRoot, key, registry } = options;

  const name = readSoleNmrCommand(crossingStep);
  if (name === undefined || name === key) {
    return undefined;
  }

  const scripts = readPackageJsonScripts(path.dirname(file));
  const value = scripts !== undefined && Object.hasOwn(scripts, name) ? scripts[name]?.trim() : undefined;
  if (value === undefined || ['', ':'].includes(value)) {
    return undefined;
  }
  if (findNmrCrossing([{ kind: 'opaque', command: value }]) !== undefined) {
    return undefined;
  }
  // nmr does not wrap a hook in hooks of its own, so only a non-hook target can carry them.
  const anchorDir = path.dirname(file);
  if (
    !isHookName(name) &&
    [`${name}:pre`, `${name}:post`].some((hook) => hasRunnableHook(hook, registry, anchorDir, isWorkspaceRoot))
  ) {
    return undefined;
  }

  const inlinedValue = escapeControlCharacters(value);

  return Object.hasOwn(registry, name)
    ? `Replace the value with \`${inlinedValue}\`, and keep \`${name}\`, which overrides nmr's own.`
    : `Replace the value with \`${inlinedValue}\` and delete \`${name}\`, the script that it names.`;
}

/**
 * Renders the line reporting a step that reaches nmr through a shell, which puts the nested run's output on the
 * channels that a tool's output takes: withheld as one block under `quiet`, and relayed through this process
 * under `full`.
 *
 * Leads with the declaration site, so that each report that a recursive run emits names the file to edit.
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
 * Returns the edit that resolves a crossing declared in a `package.json`, which does not contain a step list of its
 * own.
 *
 * The entry has to go either way; where its steps go depends on what the registry already defines for the
 * command, so the remedy tells the reader to delete outright an override that merely restates that entry. A step
 * list contains nmr commands alone; the remedy names a hook, rather than the list, for anything else that the
 * entry runs.
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
      `A \`package.json\` script cannot contain a step list: define \`${key}\` in \`${configSite}\` and move the ` +
      `package-specific steps to ${describeStepDestination(key)}.`
    );
  }

  const registryChain = renderChain(expandScript(registryEntry, isWorkspaceRoot));
  if (registryChain === crossingStep) {
    return `Delete the entry: nmr's own \`${key}\` already runs \`${escapeControlCharacters(registryChain)}\`.`;
  }

  return `Delete the entry and move the steps that it adds to ${describeStepDestination(key)}.`;
}

/**
 * Returns the edit that resolves a self-referential entry.
 *
 * A hook takes an edit of its own: nmr does not wrap a `:pre` or `:post` script in hooks, so the hook does not
 * have a script below it to which steps could move. The hook's edit deletes the re-invocation instead, which
 * leaves the steps beside it as the ones that the hook runs.
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
    return `Delete the re-invocation: \`${command}\` runs the steps beside it.`;
  }

  const configSite = path.relative(monorepoRoot, resolveConfigPath(monorepoRoot));

  return formatPackageRemedy({ configSite, crossingStep: script, isWorkspaceRoot, key: command, registry });
}

// endregion | Helpers
