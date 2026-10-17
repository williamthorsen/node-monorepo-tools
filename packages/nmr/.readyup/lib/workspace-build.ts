import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { CheckOutcome, RdyCheck } from 'readyup';
import { fileExists, readFile } from 'readyup/check-utils';

export const buildReadinessChecks: RdyCheck[] = [
  {
    name: 'all workspace packages can build',
    severity: 'warn',
    check: allWorkspacePackagesCanBuild,
    fix: 'Add "build": ":" to packages that don\'t need a build, or ensure packages that use the default nmr build have a tsconfig.json and a src/ directory',
  },
];

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
