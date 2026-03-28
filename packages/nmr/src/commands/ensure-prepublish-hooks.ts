import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { getWorkspacePackageDirs } from '../context.js';
import { readPackageJson } from '../helpers/package-json.js';
import { isObject } from '../helpers/type-guards.js';

export interface PackageHookStatus {
  packageName: string;
  packageDir: string;
  isPrivate: boolean;
  prepublishOnly: string | undefined;
  action: 'ok' | 'missing' | 'fixed' | 'would-fix';
}

export interface EnsurePrepublishHooksResult {
  packages: PackageHookStatus[];
  hasFailures: boolean;
}

export const DEFAULT_HOOK = 'npm run build';

/**
 * Check (and optionally fix) whether all publishable workspace packages
 * have a `prepublishOnly` script.
 */
export function ensurePrepublishHooks(
  monorepoRoot: string,
  options: { fix: boolean; dryRun: boolean; command?: string },
): EnsurePrepublishHooksResult {
  const hookCommand = options.command ?? DEFAULT_HOOK;
  const packageDirs = getWorkspacePackageDirs(monorepoRoot);
  const packages: PackageHookStatus[] = [];

  for (const packageDir of packageDirs) {
    const pkg = readPackageJson(packageDir);
    const packageName = pkg.name ?? path.basename(packageDir);
    const isPrivate = pkg.private === true;

    if (isPrivate) {
      packages.push({
        packageName,
        packageDir,
        isPrivate: true,
        prepublishOnly: pkg.scripts?.prepublishOnly,
        action: 'ok',
      });
      continue;
    }

    const existing = pkg.scripts?.prepublishOnly;

    if (existing) {
      packages.push({
        packageName,
        packageDir,
        isPrivate: false,
        prepublishOnly: existing,
        action: 'ok',
      });
      continue;
    }

    if (options.fix) {
      const action = options.dryRun ? ('would-fix' as const) : ('fixed' as const);

      if (!options.dryRun) {
        addPrepublishOnly(packageDir, hookCommand);
      }

      packages.push({
        packageName,
        packageDir,
        isPrivate: false,
        prepublishOnly: undefined,
        action,
      });
    } else {
      packages.push({
        packageName,
        packageDir,
        isPrivate: false,
        prepublishOnly: undefined,
        action: 'missing',
      });
    }
  }

  const hasFailures = packages.some((p) => p.action === 'missing');

  return { packages, hasFailures };
}

/** Read a package.json, insert `prepublishOnly` into scripts, and write back. */
function addPrepublishOnly(packageDir: string, command: string): void {
  const filePath = path.join(packageDir, 'package.json');
  const raw = readFileSync(filePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);

  if (!isObject(parsed)) {
    throw new TypeError(`Invalid package.json in ${packageDir}: expected an object`);
  }

  const scripts = isObject(parsed.scripts) ? parsed.scripts : {};
  scripts.prepublishOnly = command;
  parsed.scripts = scripts;

  writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
}
