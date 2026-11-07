import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describeError } from '@williamthorsen/toolbelt.errors';
import type { CheckOutcome, RdyCheck } from 'readyup';
import { fileExists, readFile } from 'readyup/check-utils';

import { ensurePrepublishHooks } from '../../src/commands/ensure-prepublish-hooks.ts';
import { formatPaths } from './repo-files.ts';

export const buildReadinessChecks: RdyCheck[] = [
  {
    name: 'all workspace packages can build',
    severity: 'warn',
    check: allWorkspacePackagesCanBuild,
    fix: 'Add "build": ":" to packages that don\'t need a build, or ensure packages that use the default nmr build have a tsconfig.json and a src/ directory',
  },
  {
    name: 'every publishable package declares prepublishOnly',
    severity: 'warn',
    check: everyPublishablePackageDeclaresPrepublishOnly,
    fix: 'Add "prepublishOnly": "nmr build" to the scripts of each listed package, or run ensure-prepublish-hooks --fix. A package without it publishes without its build output',
  },
];

/**
 * Checks that every non-private workspace package declares a `prepublishOnly` script, by the predicate of
 * `ensure-prepublish-hooks`.
 *
 * A throw from the predicate, for a missing `pnpm-workspace.yaml` or an invalid manifest, is returned as a failure,
 * because readyup aborts the rest of the checklist on a throw.
 *
 * @internal - Exported only to enable testing
 */
export function everyPublishablePackageDeclaresPrepublishOnly(): boolean | CheckOutcome {
  try {
    const { packages } = ensurePrepublishHooks(process.cwd(), { shouldFix: false, isDryRun: false });
    const offenders = packages
      .filter((packageStatus) => packageStatus.action === 'missing')
      .map((packageStatus) => packageStatus.packageName);

    if (offenders.length === 0) return true;
    return { ok: false, detail: formatPaths(offenders) };
  } catch (error) {
    return { ok: false, detail: describeError(error) };
  }
}

// region | Helpers

/**
 * Checks that every workspace package can run `nmr build`: Its package.json overrides "build", or it has the
 * inputs that the default nmr-compile build needs, a tsconfig.json and a src/ directory.
 */
function allWorkspacePackagesCanBuild(): boolean | CheckOutcome {
  const packagesDir = join(process.cwd(), 'packages');
  if (!existsSync(packagesDir)) return true;

  const entries = readdirSync(packagesDir, { withFileTypes: true });
  const failingPackages: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgPath = `packages/${entry.name}/package.json`;
    const content = readFile(pkgPath);
    if (!content) continue;

    const hasBuildOverride = /"build"\s*:/.test(content);
    const hasDefaultBuildInputs =
      fileExists(`packages/${entry.name}/tsconfig.json`) && existsSync(join(packagesDir, entry.name, 'src'));

    if (!hasBuildOverride && !hasDefaultBuildInputs) {
      failingPackages.push(entry.name);
    }
  }

  if (failingPackages.length === 0) return true;
  return {
    ok: false,
    detail: `missing build override or tsconfig.json + src/: ${failingPackages.join(', ')}`,
  };
}

// endregion | Helpers
