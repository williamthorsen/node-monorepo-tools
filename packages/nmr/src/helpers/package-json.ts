import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isObject } from './type-guards.ts';

export interface PackageJson {
  name?: string;
  private?: boolean;
  version?: string;
  packageManager?: string;
  main?: string;
  exports?: unknown;
  scripts?: Record<string, string>;
  pnpm?: { overrides?: Record<string, string> };
}

/**
 * Reads and parses a package.json file at the given directory.
 */
export function readPackageJson(dir: string): PackageJson {
  const content = readFileSync(path.join(dir, 'package.json'), 'utf8');
  const parsed: unknown = JSON.parse(content);

  if (!isObject(parsed)) {
    throw new TypeError(`Invalid package.json in ${dir}: expected an object`);
  }

  // After isObject guard, we know parsed is Record<string, unknown>.
  // PackageJson fields are all optional, so this is structurally compatible.
  const pkg: PackageJson = {};
  if (typeof parsed.name === 'string') pkg.name = parsed.name;
  if (parsed.private === true) pkg.private = true;
  if (typeof parsed.version === 'string') pkg.version = parsed.version;
  if (typeof parsed.packageManager === 'string') pkg.packageManager = parsed.packageManager;
  if (typeof parsed.main === 'string') pkg.main = parsed.main;
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
