import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { type OutputStyle, STATUS_GLYPHS } from '@williamthorsen/nmr-core';

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
  options: { shouldFix: boolean; isDryRun: boolean; command?: string },
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

    const existingHook = pkg.scripts?.['prepublishOnly'];

    if (existingHook) {
      packages.push({
        packageName,
        packageDir,
        isPrivate: false,
        prepublishOnly: existingHook,
        action: 'ok',
      });
      continue;
    }

    if (options.shouldFix) {
      const action = options.isDryRun ? ('would-fix' as const) : ('fixed' as const);

      if (!options.isDryRun) {
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
 * Every line goes to stdout, a failure's included, and the exit code is what carries a failure. A report split
 * across two streams leaves no reader holding the whole list.
 */
export function reportPrepublishHooks(
  result: EnsurePrepublishHooksResult,
  hookCommand: string,
  style: OutputStyle,
): void {
  const publishablePackages = result.packages.filter((pkg) => !pkg.isPrivate);

  if (publishablePackages.length === 0) {
    console.info('No publishable packages found.');
    return;
  }

  for (const pkg of publishablePackages) {
    console.info(renderHookStatus(pkg, hookCommand, style));
  }

  reportClosing(describeHookRun(publishablePackages));
}

// region | Helpers

/** Read a package.json, insert `prepublishOnly` into scripts, and write back. */
function addPrepublishOnly(packageDir: string, command: string): void {
  const filePath = path.join(packageDir, 'package.json');
  const rawText = readFileSync(filePath, 'utf8');
  const parsedManifest: unknown = JSON.parse(rawText);

  if (!isObject(parsedManifest)) {
    throw new TypeError(`Invalid package.json in ${packageDir}: expected an object`);
  }

  const scripts = isObject(parsedManifest['scripts']) ? parsedManifest['scripts'] : {};
  scripts['prepublishOnly'] = command;
  parsedManifest['scripts'] = scripts;

  writeFileSync(filePath, JSON.stringify(parsedManifest, null, 2) + '\n', 'utf8');
}

/** Counts the packages a run left in the given state. */
function countAction(publishablePackages: PackageHookStatus[], action: PackageHookStatus['action']): number {
  return publishablePackages.filter((pkg) => pkg.action === action).length;
}

/** Names what a run came to: the packages carrying the hook, or what became of those that were not. */
function describeHookRun(publishablePackages: PackageHookStatus[]): string {
  const packages =
    publishablePackages.length === 1 ? '1 publishable package' : `${publishablePackages.length} publishable packages`;

  const missingCount = countAction(publishablePackages, 'missing');
  if (missingCount > 0) {
    return `${missingCount} of ${packages} ${missingCount === 1 ? 'is' : 'are'} missing prepublishOnly. Run with --fix to add it.`;
  }

  const fixedCount = countAction(publishablePackages, 'fixed');
  if (fixedCount > 0) {
    return `Added prepublishOnly to ${fixedCount} of ${packages}.`;
  }

  const wouldFixCount = countAction(publishablePackages, 'would-fix');
  if (wouldFixCount > 0) {
    return `Would add prepublishOnly to ${wouldFixCount} of ${packages}.`;
  }

  return `${packages} ${publishablePackages.length === 1 ? 'has' : 'have'} prepublishOnly.`;
}

/**
 * Renders one package's line, naming the hook it carries or the one the run would add.
 *
 * A package carrying the hook and one the run added both pass, so both open on the pass marker; the dry run's
 * `~` is neither outcome and stays the mark of a line reporting what a write would do.
 */
function renderHookStatus(pkg: PackageHookStatus, hookCommand: string, style: OutputStyle): string {
  const statuses = STATUS_GLYPHS[style];

  switch (pkg.action) {
    case 'ok':
      return `${statuses.passed.text} ${pkg.packageName}: prepublishOnly = "${pkg.prepublishOnly}"`;
    case 'missing':
      return `${statuses.failed.text} ${pkg.packageName}: missing prepublishOnly`;
    case 'fixed':
      return `${statuses.passed.text} ${pkg.packageName}: added prepublishOnly = "${hookCommand}"`;
    case 'would-fix':
      return `~ ${pkg.packageName}: would add prepublishOnly = "${hookCommand}"`;
  }
}

// endregion | Helpers
