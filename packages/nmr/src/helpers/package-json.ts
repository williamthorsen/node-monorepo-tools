import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describeError } from '@williamthorsen/toolbelt.errors';

import { CONFIG_RELATIVE_PATH } from '../config.ts';
import { UserError } from '../UserError.ts';
import { isMonorepoRoot } from '../workspace.ts';
import { readStringValues } from './readStringValues.ts';
import { isObject } from './type-guards.ts';

/**
 * The `package.json` fields that carry a dependency's version specifier.
 *
 * pnpm accepts the `catalog:` protocol in all four, so a reader looking for catalogued dependencies has to
 * sweep the whole set rather than the two that carry most of them.
 */
export const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

export type DependencyField = (typeof DEPENDENCY_FIELDS)[number];

export type PackageJson = {
  name?: string;
  private?: boolean;
  version?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
  // Kept unnarrowed: its one reader proves the block absent, and a value dropped on the way in would be a key
  // the proof never sees.
  pnpm?: { overrides?: Record<string, unknown> };
} & { [K in DependencyField]?: Record<string, string> };

/**
 * Reads and parses the package.json at the given directory, keeping only the fields nmr reads.
 */
export function readPackageJson(dir: string): PackageJson {
  const file = resolvePackageJsonPath(dir);
  const parsed = parsePackageJson(readFileSync(file, 'utf8'), file);

  if (!isObject(parsed)) {
    throw new UserError(`Invalid package.json in ${dir}: expected an object`);
  }

  const pkg: PackageJson = {};
  if (typeof parsed['name'] === 'string') pkg.name = parsed['name'];
  if (parsed['private'] === true) pkg.private = true;
  if (typeof parsed['version'] === 'string') pkg.version = parsed['version'];
  if (typeof parsed['packageManager'] === 'string') pkg.packageManager = parsed['packageManager'];
  if (isObject(parsed['scripts'])) {
    pkg.scripts = readScriptRecord(dir, parsed['scripts']);
  }
  if (isObject(parsed['pnpm'])) {
    const pnpm = parsed['pnpm'];
    if (isObject(pnpm['overrides'])) {
      pkg.pnpm = { overrides: pnpm['overrides'] };
    }
  }
  for (const field of DEPENDENCY_FIELDS) {
    const declared = parsed[field];
    if (isObject(declared)) {
      pkg[field] = readStringValues(declared);
    }
  }

  return pkg;
}

/**
 * Returns the `pnpm.overrides` block a package.json declares, every key it holds and each value as written.
 */
export function getPnpmOverrides(pkg: PackageJson): Record<string, unknown> | undefined {
  if (!isObject(pkg.pnpm)) return undefined;

  const overrides = pkg.pnpm.overrides;

  return isObject(overrides) ? overrides : undefined;
}

/**
 * Parses a `package.json`'s text, rejecting what does not parse.
 *
 * A file the user wrote by hand is theirs to fix, so the failure names it rather than reporting the parser's
 * own stack.
 */
export function parsePackageJson(raw: string, file: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error: unknown) {
    throw new UserError(`Invalid package.json at ${file}: ${describeError(error)}`);
  }
}

/**
 * Narrows a `scripts` record to strings, rejecting any value that is not one.
 *
 * npm and pnpm read a script as a string too, so a value of any other type is malformed however it got there.
 * Dropping one silently would let a caller run something else in its place and report nothing.
 */
export function readScriptRecord(dir: string, scripts: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(scripts)) {
    if (typeof value !== 'string') {
      throw new UserError(formatMalformedScript(dir, key, value));
    }
    result[key] = value;
  }
  return result;
}

/** Resolves the `package.json` path for a directory: the file tier-3 scripts are read from. */
export function resolvePackageJsonPath(dir: string): string {
  return path.join(dir, 'package.json');
}

// region | Helpers

/**
 * Returns the message rejecting a `package.json` script value that is not a string, naming where a step list
 * belongs when the value is one. The root's own scripts sit at a different config key than a package's.
 */
function formatMalformedScript(dir: string, key: string, value: unknown): string {
  const rejection = `Invalid package.json at ${resolvePackageJsonPath(dir)}: \`scripts.${key}\` must be a string.`;
  if (!Array.isArray(value)) {
    return rejection;
  }

  const field = isMonorepoRoot(dir) ? 'rootScripts' : 'workspaceScripts';

  return `${rejection} A step list belongs in \`${CONFIG_RELATIVE_PATH}\` under \`${field}\`.`;
}

// endregion | Helpers
