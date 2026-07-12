import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isObject } from './type-guards.ts';

export interface PackageJson {
  name?: string;
  private?: boolean;
  version?: string;
  packageManager?: string;
  main?: string;
  types?: string;
  typings?: string;
  exports?: unknown;
  scripts?: Record<string, string>;
  pnpm?: { overrides?: Record<string, string> };
}

/**
 * Reads and parses a package.json file at the given directory.
 */
export function readPackageJson(dir: string): PackageJson {
  return parsePackageJson(readFileSync(path.join(dir, 'package.json'), 'utf8'), dir);
}

/**
 * Parses package.json content. `source` names the origin (a directory, or a tarball path) for error messages.
 */
export function parsePackageJson(content: string, source: string): PackageJson {
  const parsed: unknown = JSON.parse(content);

  if (!isObject(parsed)) {
    throw new TypeError(`Invalid package.json in ${source}: expected an object`);
  }

  // After isObject guard, we know parsed is Record<string, unknown>.
  // PackageJson fields are all optional, so this is structurally compatible.
  const pkg: PackageJson = {};
  if (typeof parsed.name === 'string') pkg.name = parsed.name;
  if (parsed.private === true) pkg.private = true;
  if (typeof parsed.version === 'string') pkg.version = parsed.version;
  if (typeof parsed.packageManager === 'string') pkg.packageManager = parsed.packageManager;
  if (typeof parsed.main === 'string') pkg.main = parsed.main;
  if (typeof parsed.types === 'string') pkg.types = parsed.types;
  if (typeof parsed.typings === 'string') pkg.typings = parsed.typings;
  if (parsed.exports !== undefined) pkg.exports = parsed.exports;
  if (isObject(parsed.scripts)) {
    const scripts: Record<string, string> = {};
    for (const [key, val] of Object.entries(parsed.scripts)) {
      if (typeof val === 'string') scripts[key] = val;
    }
    pkg.scripts = scripts;
  }
  if (isObject(parsed.pnpm)) {
    const pnpm = parsed.pnpm;
    if (isObject(pnpm.overrides)) {
      const overrides: Record<string, string> = {};
      for (const [key, val] of Object.entries(pnpm.overrides)) {
        if (typeof val === 'string') overrides[key] = val;
      }
      pkg.pnpm = { overrides };
    }
  }

  return pkg;
}

/**
 * Reports whether a package declares a publishable entry point — a `main` or an
 * `exports` field. A package with neither has no importable surface for attw to
 * resolve (a `bin`-only package included), so attw would false-positive on it.
 */
export function hasPublishableEntryPoint(pkg: PackageJson): boolean {
  return pkg.main !== undefined || pkg.exports !== undefined;
}

/**
 * Collects every path at which a package declares type declarations: a top-level `types`/`typings`
 * field, and the target of every `types` condition in `exports`. An empty result means the package
 * makes no type claim — a valid JavaScript package, and not something to fail.
 */
export function getDeclaredTypesPaths(pkg: PackageJson): string[] {
  const paths: string[] = [];
  if (pkg.types !== undefined) paths.push(pkg.types);
  if (pkg.typings !== undefined) paths.push(pkg.typings);
  collectTypesConditions(pkg.exports, paths);
  return [...new Set(paths)];
}

/**
 * Checks if a package.json has pnpm overrides and returns them.
 */
export function getPnpmOverrides(pkg: PackageJson): Record<string, string> | undefined {
  if (!isObject(pkg.pnpm)) return undefined;

  const overrides = pkg.pnpm.overrides;
  if (!isObject(overrides)) return undefined;

  // Verify all values are strings
  for (const value of Object.values(overrides)) {
    if (typeof value !== 'string') return undefined;
  }

  return overrides;
}

/**
 * Walks an `exports` value, collecting the target of every `types` condition. A condition key is
 * exactly `types`; a subpath key such as `"./types"` begins with `.` and is not one.
 */
function collectTypesConditions(exportsValue: unknown, paths: string[]): void {
  if (Array.isArray(exportsValue)) {
    for (const entry of exportsValue) collectTypesConditions(entry, paths);
    return;
  }
  if (!isObject(exportsValue)) return;

  for (const [key, value] of Object.entries(exportsValue)) {
    if (key === 'types') {
      collectConditionTargets(value, paths);
    } else {
      collectTypesConditions(value, paths);
    }
  }
}

/**
 * Collects every path reachable from a condition's target, which may be a bare path, an array of
 * alternatives, or a further nested condition map (`"types": { "import": …, "require": … }`). A `null`
 * target — the documented way to withdraw a subpath — contributes nothing.
 */
function collectConditionTargets(target: unknown, paths: string[]): void {
  if (typeof target === 'string') {
    paths.push(target);
    return;
  }
  if (Array.isArray(target)) {
    for (const entry of target) collectConditionTargets(entry, paths);
    return;
  }
  if (isObject(target)) {
    for (const value of Object.values(target)) collectConditionTargets(value, paths);
  }
}
