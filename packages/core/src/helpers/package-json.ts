import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface PackageJson {
  name?: string;
  version?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
  pnpm?: { overrides?: Record<string, string> };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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

  return parsed as PackageJson;
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

  return overrides as Record<string, string>;
}
