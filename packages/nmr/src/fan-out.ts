import type { Writable } from 'node:stream';

import { reportError } from '@williamthorsen/nmr-core';

import type { ResolvedContext } from './context.ts';
import { type FilterSelection, readFilterSelection } from './helpers/filter-selection.ts';
import { findClosestName } from './helpers/findClosestName.ts';
import { renderQuotedList } from './helpers/renderQuotedList.ts';
import { RUN_IF_PRESENT_ENV_VAR, type RunCliResult } from './invocation.ts';
import type { ParsedArgs } from './invocation-args.ts';
import { buildRootRegistry, buildWorkspaceRegistry, readPackageJsonScripts } from './resolver.ts';
import { runSteps, type RunStepsOptions } from './runner.ts';
import type { Step } from './steps.ts';
import { readWorkspacePackageNames, resolveWorkspace } from './workspace.ts';

/**
 * Leads the line that nmr prints for a recursive invocation when the workspace to which it would fan out does not
 * contain any package.
 */
const RECURSIVE_REJECTION = '-R/--recursive did not match any workspace:';

/**
 * Composes the delegation that an `-F` or `-R` calls for, or `undefined` when the invocation runs here.
 *
 * One structural step, to keep the pattern given to `-F` and the arguments passed on as argv tokens rather than
 * text spliced into a shell string, and to make the nmr processes underneath write where this one writes although
 * the binary spawned is `pnpm`. A flag of nmr's own precedes the command name, where the nmr underneath reads
 * it as its own rather than passing it on to the command.
 *
 * A `--log` fan-out surveys the scopes selected, so a scope with nothing to show is a gap in the survey rather
 * than a failure of it, however that scope was selected.
 */
export function composeDelegation(options: {
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
 * Reports whether any scope that a delegation can select defines the command. A package config does not define
 * scripts, so the root config's registries and each `package.json` cover every scope.
 */
export function isDefinedInAnyScope(command: string, context: ResolvedContext): boolean {
  const registries = [buildRootRegistry(context.config, context.monorepoRoot), buildWorkspaceRegistry(context.config)];
  if (registries.some((registry) => Object.hasOwn(registry, command))) {
    return true;
  }

  return [context.monorepoRoot, ...context.workspacePackageDirs].some((dir) =>
    Object.hasOwn(readPackageJsonScripts(dir) ?? {}, command),
  );
}

/**
 * Runs a `-F` or `-R` delegation, or refuses it when it would not select any scope.
 *
 * The refusal precedes the delegate rather than reading its outcome, since a delegation that selected nothing
 * has already run to completion, reporting nothing and exiting 0, by the time nmr sees it.
 *
 * A `-R` delegation withholds stdin from its packages, as does a filter that pnpm lists as several packages. pnpm 12
 * starts each package of a concurrent `exec` in a background process group, which the system stops when it reads
 * from the terminal or changes its mode, so a command such as `next build` would hang the run. pnpm keeps a serial
 * run in the foreground, which nmr cannot observe; `-R` itself and a filter's package count stand in for it, and a
 * `-R` or a dependency-chain filter that pnpm runs serially loses its input as well. A filter whose selection pnpm
 * did not report keeps nmr's stdin.
 */
export async function runDelegation(options: {
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

// region | Helpers

/**
 * Returns the clause naming what a non-empty `packages` list declares. The resolver reports a manifest that
 * does not declare a list under a cause of its own.
 *
 * An entry that the parser left empty is what an unquoted `!pkg` becomes, and the matcher drops it. Naming it as
 * an empty entry is what a reader can act on: quoting it renders an empty pair of backticks, and it does so in the
 * one case for which the `no-pattern` remedy is written.
 */
function describeDeclaredPatterns(patterns: readonly string[]): string {
  const quotablePatterns = patterns.filter((pattern) => pattern.trim() !== '');
  const emptiedCount = patterns.length - quotablePatterns.length;

  if (emptiedCount === 0) {
    return `declares ${renderQuotedList(patterns)}`;
  }

  const emptiedClause = `${emptiedCount} ${emptiedCount === 1 ? 'entry' : 'entries'} that YAML left empty`;

  return quotablePatterns.length === 0
    ? `declares ${emptiedClause}`
    : `declares ${renderQuotedList(quotablePatterns)}, beside ${emptiedClause}`;
}

/**
 * Returns the sentences naming why the workspace does not contain any package, and the remedy for that cause. A
 * cause whose manifest declares a readable `packages` list quotes that list.
 *
 * The `package.json` requirement is stated under `no-package` because it is a divergence from pnpm, which
 * recognizes two further manifests, and the reader of a workspace that pnpm resolves cannot infer it.
 */
function describeEmptyWorkspace(monorepoRoot: string): string {
  const resolution = resolveWorkspace(monorepoRoot);
  if (resolution.kind !== 'empty') {
    // The caller resolved this root at startup and did not find any package, so anything else means the manifest
    // or the tree beneath it moved since, and a second run reads the workspace as it now stands.
    return `pnpm-workspace.yaml at ${monorepoRoot} resolves differently now than it did when the run started.`;
  }

  const { cause, patterns } = resolution;
  const declaredClause = describeDeclaredPatterns(patterns);

  switch (cause) {
    case 'all-excluded':
      return (
        `pnpm-workspace.yaml ${declaredClause}, whose \`!\` entries exclude every directory matched by the positive ` +
        'patterns. Drop or narrow the exclusion.'
      );
    case 'no-package':
      return (
        `pnpm-workspace.yaml ${declaredClause}, and the matcher did not find any directory containing a \`package.json\`. ` +
        'nmr counts a directory as a package only when it contains `package.json`; unlike pnpm, it recognizes ' +
        'neither `package.yaml` nor `package.json5`. Add a `package.json` to the directory that should be a ' +
        'package, or declare a pattern reaching a directory that contains one.'
      );
    case 'no-packages-list':
      return (
        `pnpm-workspace.yaml at ${monorepoRoot} does not declare a \`packages\` list, so the workspace contains the root ` +
        'package alone. Declare a positive pattern such as `packages/*` to reach the packages beneath it.'
      );
    case 'no-pattern':
      return (
        `pnpm-workspace.yaml ${declaredClause}, so the matcher does not receive any pattern. Declare a positive ` +
        'pattern such as `packages/*`, and quote any `!` entry, which YAML reads as a tag rather than a string ' +
        'when it is unquoted.'
      );
    case 'unreadable-packages':
      return (
        `pnpm-workspace.yaml at ${monorepoRoot} declares a \`packages\` value that is not a list of strings, so ` +
        'nothing it declares reaches the matcher. Make it a list whose every entry is a quoted pattern; a bare ' +
        'value and an entry YAML read as a number or a map are the usual ones.'
      );
    case 'unreadable-manifest':
      return (
        `pnpm-workspace.yaml at ${monorepoRoot} is not valid YAML, so the matcher does not receive anything that it declares. ` +
        'Repair the syntax error and run the command again. An unterminated quoted string and a mis-indented ' +
        'entry are the usual ones.'
      );
    default: {
      const unhandledCause: never = cause;
      throw new Error(`Unhandled empty-workspace cause: ${String(unhandledCause)}`);
    }
  }
}

/**
 * Returns the line refusing a delegation that would not select any scope, or `undefined` when it selects at
 * least one.
 *
 * A selection of nothing runs nothing and reports nothing, which reads exactly like a run that passed. pnpm
 * provides neither signal -- its exit code is 0 either way, and the `Scope: 0 of N` line that it prints under
 * `run` is absent under the `exec` that a delegation composes -- so the refusal is nmr's to make, ahead of the
 * delegate.
 *
 * A filter is put to pnpm, which owns what the pattern means, and `selection` is pnpm's answer; a `-R` is not,
 * and has none, since `pnpm --recursive` leaves the root project out and a workspace that does not declare any
 * package is its only empty selection.
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
    // Because a workspace without a package would have refused whatever the pattern was, the pattern-shape
    // rules below answer the wrong question there: a name rule and a near-name search cannot repair a workspace.
    if (isPackageless) {
      return `${formatFilterRejection(parsedArgs.filter)} ${describeEmptyWorkspace(context.monorepoRoot)}`;
    }
    return formatEmptyFilterError(parsedArgs.filter, readWorkspacePackageNames(context.workspacePackageDirs));
  }

  return isPackageless ? `${RECURSIVE_REJECTION} ${describeEmptyWorkspace(context.monorepoRoot)}` : undefined;
}

/**
 * Returns the line for a filter that does not select any workspace, naming the pattern and what it is matched
 * against.
 *
 * The rule is stated because the mistake that it catches is passing a directory name: a package's directory and
 * its manifest `name` differ often enough that the pattern looks right to the reader who wrote it.
 *
 * A pattern of any other recognized form gets the rule for that form without a suggestion, because it does not
 * contain a name.
 */
function formatEmptyFilterError(pattern: string, names: readonly string[]): string {
  const rejection = formatFilterRejection(pattern);

  if (pattern.startsWith('!')) {
    return `${rejection} A pattern beginning with \`!\` excludes what it matches, and this one excludes every package.`;
  }

  if (pattern.includes('[')) {
    return `${rejection} A pattern containing \`[<ref>]\` selects the packages changed since a git ref, and none has changed.`;
  }

  if (pattern.startsWith('.') || pattern.startsWith('/') || pattern.startsWith('{')) {
    return (
      `${rejection} ` +
      'A pattern written `./dir`, `/dir`, or `{dir}` selects the packages under a directory, ' +
      'and this directory does not contain any package.'
    );
  }

  return (
    `${rejection} A pattern matches a package's manifest \`name\`, ` +
    `not its directory name.${suggestWorkspaceNames(pattern, names)}`
  );
}

/** Returns the rejection that leads a filter's line, naming the pattern that selected nothing. */
function formatFilterRejection(pattern: string): string {
  return `-F/--filter did not match any workspace: \`${pattern}\`.`;
}

/**
 * Returns the sentence pointing a rejected pattern at the names that it could have named, or an empty string when
 * the workspace declares none.
 *
 * A containing name comes ahead of the nearest one: a directory name commonly stands for a longer manifest
 * name, and `secrets` is sixteen edits from `@scope/toolbelt.secrets`, past any ceiling that would still reject
 * a name that the user never meant.
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

// endregion | Helpers
