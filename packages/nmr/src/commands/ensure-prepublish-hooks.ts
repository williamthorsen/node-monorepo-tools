import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { readPackageJson } from '../helpers/package-json.ts';
import { reportClosing } from '../helpers/reportClosing.ts';
import { isObject } from '../helpers/type-guards.ts';
import { getWorkspacePackageDirs } from '../workspace.ts';

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
        prepublishOnly: pkg.scripts?.['prepublishOnly'],
        action: 'ok',
      });
      continue;
    }

    const existing = pkg.scripts?.['prepublishOnly'];

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

/**
 * Reports one line per publishable package and closes with what the run came to. Private packages appear in
 * neither: they publish nothing, so a `prepublishOnly` is not theirs to carry.
 *
 * Every line goes to stdout, the `✗` included, and the exit code is what carries a failure. A report split
 * across two streams leaves no reader holding the whole list.
 */
export function reportPrepublishHooks(result: EnsurePrepublishHooksResult, hookCommand: string): void {
  const publishable = result.packages.filter((pkg) => !pkg.isPrivate);

  if (publishable.length === 0) {
    console.info('No publishable packages found.');
    return;
  }

  for (const pkg of publishable) {
    console.info(renderHookStatus(pkg, hookCommand));
  }

  reportClosing(describeHookRun(publishable));
}

// region | Helpers

/** Read a package.json, insert `prepublishOnly` into scripts, and write back. */
function addPrepublishOnly(packageDir: string, command: string): void {
  const filePath = path.join(packageDir, 'package.json');
  const raw = readFileSync(filePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);

  if (!isObject(parsed)) {
    throw new TypeError(`Invalid package.json in ${packageDir}: expected an object`);
  }

  const scripts = isObject(parsed['scripts']) ? parsed['scripts'] : {};
  scripts['prepublishOnly'] = command;
  parsed['scripts'] = scripts;

  writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
}

/** Counts the packages a run left in the given state. */
function countAction(publishable: PackageHookStatus[], action: PackageHookStatus['action']): number {
  return publishable.filter((pkg) => pkg.action === action).length;
}

/** Names what a run came to: the packages carrying the hook, or what became of those that were not. */
function describeHookRun(publishable: PackageHookStatus[]): string {
  const packages = publishable.length === 1 ? '1 publishable package' : `${publishable.length} publishable packages`;

  const missing = countAction(publishable, 'missing');
  if (missing > 0) {
    return `${missing} of ${packages} ${missing === 1 ? 'is' : 'are'} missing prepublishOnly. Run with --fix to add it.`;
  }

  const fixed = countAction(publishable, 'fixed');
  if (fixed > 0) {
    return `Added prepublishOnly to ${fixed} of ${packages}.`;
  }

  const wouldFix = countAction(publishable, 'would-fix');
  if (wouldFix > 0) {
    return `Would add prepublishOnly to ${wouldFix} of ${packages}.`;
  }

  return `${packages} ${publishable.length === 1 ? 'has' : 'have'} prepublishOnly.`;
}

/** Renders one package's line, naming the hook it carries or the one the run would add. */
function renderHookStatus(pkg: PackageHookStatus, hookCommand: string): string {
  switch (pkg.action) {
    case 'ok':
      return `✓ ${pkg.packageName}: prepublishOnly = "${pkg.prepublishOnly}"`;
    case 'missing':
      return `✗ ${pkg.packageName}: missing prepublishOnly`;
    case 'fixed':
      return `✓ ${pkg.packageName}: added prepublishOnly = "${hookCommand}"`;
    case 'would-fix':
      return `~ ${pkg.packageName}: would add prepublishOnly = "${hookCommand}"`;
  }
}

// endregion | Helpers
