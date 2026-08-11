import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isObject } from './helpers/type-guards.ts';
import type { ScriptRegistry, ScriptValue } from './resolve-scripts.ts';
import { getDefaultRootScripts, getDefaultWorkspaceScripts } from './resolve-scripts.ts';
import type { Step } from './steps.ts';
import { composeNmrStep } from './steps.ts';
import type { NmrConfig } from './types.ts';

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
 */
export function expandScript(script: ScriptValue, workspaceRoot: boolean): readonly Step[] {
  if (typeof script === 'string') {
    return [{ kind: 'opaque', command: script }];
  }
  return script.map((element) => composeNmrStep(element, workspaceRoot));
}

/**
 * Returns a description of a script for help output.
 */
export function describeScript(script: ScriptValue): string {
  return typeof script === 'string' ? script : `[${script.join(', ')}]`;
}

/**
 * Reads a package.json file and returns the scripts object.
 */
export function readPackageJsonScripts(packageDir: string): Record<string, string> | undefined {
  try {
    const raw = readFileSync(resolvePackageJsonPath(packageDir), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) return undefined;

    const scripts = parsed['scripts'];
    if (!isObject(scripts)) return undefined;

    const result: Record<string, string> = {};
    for (const [key, val] of Object.entries(scripts)) {
      if (typeof val === 'string') result[key] = val;
    }
    return result;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

/**
 * Resolves the `package.json` path for a directory: the file tier-3 scripts are read from.
 * Carried by a resolved script's origin, so a caller naming the source names the file that was read.
 */
export function resolvePackageJsonPath(packageDir: string): string {
  return path.join(packageDir, 'package.json');
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
 * Check whether a package.json script simply re-invokes the same nmr command,
 * e.g. `"build": "nmr build"` or `"build": "nmr build --verbose"`.
 */
export function isSelfReferential(script: string, commandName: string): boolean {
  const prefix = `nmr ${commandName}`;
  return script === prefix || script.startsWith(`${prefix} `);
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
      if (override !== undefined && !isSelfReferential(override, commandName)) {
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
