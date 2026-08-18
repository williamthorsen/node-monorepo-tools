import { readFileSync } from 'node:fs';
import path from 'node:path';

import { hasErrnoCode } from '@williamthorsen/nmr-core';

import { parsePackageJson, readScriptRecord, resolvePackageJsonPath } from './helpers/package-json.ts';
import { isObject } from './helpers/type-guards.ts';
import type { ScriptRegistry, ScriptValue, StepSpec } from './resolve-scripts.ts';
import { getDefaultRootScripts, getDefaultWorkspaceScripts } from './resolve-scripts.ts';
import type { Step } from './steps.ts';
import { composeNmrStep, readSelfReference } from './steps.ts';
import type { NmrConfig } from './types.ts';
import { isMonorepoRoot } from './workspace.ts';

/**
 * Replace the first token of a command with a `devBin` substitute.
 * Relative paths in the replacement are resolved from `monorepoRoot`.
 */
export function applyDevBin(command: string, devBin: Record<string, string> | undefined, monorepoRoot: string): string {
  if (!devBin) {
    return command;
  }

  const spaceIndex = command.indexOf(' ');
  const firstToken = spaceIndex === -1 ? command : command.slice(0, spaceIndex);
  const rest = spaceIndex === -1 ? '' : command.slice(spaceIndex);

  const replacement = devBin[firstToken];
  if (replacement === undefined) {
    return command;
  }

  const resolvedReplacement = resolveReplacementPaths(replacement, monorepoRoot);
  return resolvedReplacement + rest;
}

/**
 * Applies a `devBin` substitution to each opaque step, leaving nmr's own compositions alone.
 *
 * A structural step names a command nmr resolves for itself, so substituting its first token would replace the
 * `nmr` that carries the composite rather than the leaf tool `devBin` documents replacing.
 */
export function applyDevBinToSteps(
  steps: readonly Step[],
  devBin: Record<string, string> | undefined,
  monorepoRoot: string,
): readonly Step[] {
  if (!devBin) {
    return steps;
  }

  return steps.map((step) =>
    step.kind === 'opaque' ? { kind: 'opaque', command: applyDevBin(step.command, devBin, monorepoRoot) } : step,
  );
}

/**
 * Resolve relative paths in a replacement command against `monorepoRoot`.
 * The first token (the runner binary) is left as-is; subsequent tokens
 * that contain `/` and don't start with `-` are resolved.
 *
 * Limitations: any non-flag token containing `/` is treated as a path,
 * which may incorrectly resolve URL-like values or glob patterns.
 * Tokens using `--flag=path` syntax are skipped entirely because the
 * leading `-` excludes them; use the spaced form `--flag path` instead.
 */
function resolveReplacementPaths(replacement: string, monorepoRoot: string): string {
  const tokens = replacement.split(' ');
  return tokens
    .map((token, index) => {
      if (index === 0) return token;
      if (token.startsWith('-')) return token;
      if (!token.includes('/')) return token;
      return path.resolve(monorepoRoot, token);
    })
    .join(' ');
}

/**
 * Where a resolved script was read from.
 *
 * `registry` covers the built-in defaults and the repo-wide config together, which resolution cannot tell
 * apart: it receives the two already merged. A caller holding the config refines the two.
 */
export type ScriptOrigin = { tier: 'registry'; key: string } | { tier: 'package'; file: string; key: string };

export interface ResolvedScript {
  origin: ScriptOrigin;
  steps: readonly Step[];
}

/**
 * Expands a script value into the ordered steps it runs as: a string is one opaque step, and an array is one
 * structural step per element.
 *
 * A bare string element and the `{ run }` spec compose the same step. The spec's only addition is the
 * declaration of what the step does with the invocation's trailing arguments, which position cannot carry.
 */
export function expandScript(script: ScriptValue, workspaceRoot: boolean): readonly Step[] {
  if (typeof script === 'string') {
    return [{ kind: 'opaque', command: script }];
  }
  return script.map((element) =>
    typeof element === 'string'
      ? composeNmrStep(element, workspaceRoot)
      : composeNmrStep(element.run, workspaceRoot, element.declinesArgs),
  );
}

/**
 * Returns a description of a script for help output.
 */
export function describeScript(script: ScriptValue): string {
  return typeof script === 'string' ? script : `[${script.map(describeElement).join(', ')}]`;
}

/**
 * Renders one composite element for help output, naming a declining step so that two composites reading alike
 * are not routing the trailing arguments differently.
 */
function describeElement(element: string | StepSpec): string {
  if (typeof element === 'string') {
    return element;
  }
  return element.declinesArgs === true ? `${element.run} (no args)` : element.run;
}

/**
 * Reads a package.json's `scripts`, rejecting any value that is not a string.
 *
 * npm and pnpm read a script as a string too, so a value of any other type is malformed however it got there.
 * Dropping one silently would run the registry's entry in its place, which is what an array written here after
 * being told a step list resolves a shelled-nmr crossing would otherwise do.
 */
export function readPackageJsonScripts(packageDir: string): Record<string, string> | undefined {
  const file = resolvePackageJsonPath(packageDir);

  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error: unknown) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  }

  const parsed = parsePackageJson(raw, file);
  if (!isObject(parsed)) return undefined;

  const scripts = parsed['scripts'];
  if (!isObject(scripts)) return undefined;

  return readScriptRecord(packageDir, scripts);
}

/**
 * Builds the merged workspace script registry:
 * tier 1 (defaults) + tier 2 (config overrides)
 */
export function buildWorkspaceRegistry(config: NmrConfig): ScriptRegistry {
  return {
    ...getDefaultWorkspaceScripts(),
    ...config.workspaceScripts,
  };
}

/**
 * Builds the merged root script registry:
 * tier 1 (defaults) + tier 2 (config overrides)
 */
export function buildRootRegistry(config: NmrConfig): ScriptRegistry {
  return {
    ...getDefaultRootScripts(),
    ...config.rootScripts,
  };
}

/**
 * Returns a `package.json` entry that re-invokes the command it is declared under alongside other steps, or
 * `undefined` where the entry declares no such thing.
 *
 * Resolution discards a self-referential entry however it reads, so an entry that chains loses the steps it
 * chained. This is what an invocation rejects on, read where the command runs rather than raised from
 * resolution: the same scripts are resolved speculatively, for packages nobody named.
 */
export function findChainedSelfReference(packageDir: string | undefined, commandName: string): string | undefined {
  if (packageDir === undefined) {
    return undefined;
  }

  const scripts = readPackageJsonScripts(packageDir);
  if (scripts === undefined || !Object.hasOwn(scripts, commandName)) {
    return undefined;
  }

  const script = scripts[commandName];
  if (script === undefined) {
    return undefined;
  }

  return readSelfReference({ anchoredAtRoot: isMonorepoRoot(packageDir), commandName, script }) === 'chained'
    ? script
    : undefined;
}

/**
 * Reports whether a `package.json` entry re-invokes the command it is declared under, wherever the
 * re-invocation stands in it, e.g. `"build": "nmr build"` or `"build": "rdy compile && nmr build"`.
 *
 * Honouring one spawns a shell that runs the same command in the same directory, reaching the same entry
 * again without bound, so resolution discards it.
 */
export function isSelfReferential(script: string, commandName: string, packageDir: string): boolean {
  return readSelfReference({ anchoredAtRoot: isMonorepoRoot(packageDir), commandName, script }) !== undefined;
}

/**
 * Resolves a script command using the three-tier override system:
 * 1. Package defaults (built-in registry)
 * 2. Repo-wide config (.config/nmr.config.ts)
 * 3. Per-package overrides (package.json scripts)
 *
 * Returns undefined if the command is not found in the registry. A package.json override of `""` (indicating
 * skip) resolves to a single opaque step carrying it, which renders back to the empty string.
 */
export function resolveScript(
  commandName: string,
  registry: ScriptRegistry,
  packageDir: string | undefined,
  workspaceRoot: boolean,
): ResolvedScript | undefined {
  // Check tier 3: per-package package.json overrides
  if (packageDir) {
    const pkgScripts = readPackageJsonScripts(packageDir);
    if (pkgScripts && Object.hasOwn(pkgScripts, commandName)) {
      const override = pkgScripts[commandName];
      if (override !== undefined && !isSelfReferential(override, commandName, packageDir)) {
        return {
          origin: { tier: 'package', file: resolvePackageJsonPath(packageDir), key: commandName },
          steps: [{ kind: 'opaque', command: override }],
        };
      }
    }
  }

  // Check tiers 1+2 (already merged in the registry). The registry is a plain object, so the own-key check is what
  // keeps a command named for an `Object.prototype` member from resolving to the inherited value.
  if (!Object.hasOwn(registry, commandName)) {
    return undefined;
  }
  const registryEntry = registry[commandName];
  if (registryEntry === undefined) {
    return undefined;
  }

  return { origin: { tier: 'registry', key: commandName }, steps: expandScript(registryEntry, workspaceRoot) };
}
