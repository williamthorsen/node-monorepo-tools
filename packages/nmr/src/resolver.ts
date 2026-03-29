import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { NmrConfig } from './config.js';
import { isObject } from './helpers/type-guards.js';
import type { ScriptRegistry, ScriptValue } from './registries.js';
import { getDefaultRootScripts, getDefaultWorkspaceScripts } from './registries.js';

export interface ResolvedScript {
  command: string;
  source: 'default' | 'package';
}

/**
 * Expands a script value into an executable command string.
 * Arrays are expanded to `nmr {step1} && nmr {step2}`.
 */
export function expandScript(script: ScriptValue): string {
  if (typeof script === 'string') {
    return script;
  }
  return script.map((s) => `nmr ${s}`).join(' && ');
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
function readPackageJsonScripts(packageDir: string): Record<string, string> | undefined {
  try {
    const raw = readFileSync(path.join(packageDir, 'package.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) return undefined;

    const scripts = parsed.scripts;
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
 * Builds the merged workspace script registry:
 * tier 1 (defaults) + tier 2 (config overrides)
 */
export function buildWorkspaceRegistry(config: NmrConfig, useIntTests: boolean): ScriptRegistry {
  return {
    ...getDefaultWorkspaceScripts(useIntTests),
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
function isSelfReferential(script: string, commandName: string): boolean {
  const prefix = `nmr ${commandName}`;
  return script === prefix || script.startsWith(`${prefix} `);
}

/**
 * Resolves a script command using the three-tier override system:
 * 1. Package defaults (built-in registry)
 * 2. Repo-wide config (.config/nmr.config.ts)
 * 3. Per-package overrides (package.json scripts)
 *
 * Returns undefined if the command is not found in the registry.
 * Returns a ResolvedScript with an empty command if the package.json
 * override is an empty string (indicating skip).
 */
export function resolveScript(
  commandName: string,
  registry: ScriptRegistry,
  packageDir?: string,
): ResolvedScript | undefined {
  // Check tier 3: per-package package.json overrides
  if (packageDir) {
    const pkgScripts = readPackageJsonScripts(packageDir);
    if (pkgScripts && commandName in pkgScripts) {
      const override = pkgScripts[commandName];
      if (override !== undefined && !isSelfReferential(override, commandName)) {
        return { command: override, source: 'package' };
      }
    }
  }

  // Check tiers 1+2 (already merged in the registry)
  const registryEntry = registry[commandName];
  if (registryEntry === undefined) {
    return undefined;
  }

  return { command: expandScript(registryEntry), source: 'default' };
}
