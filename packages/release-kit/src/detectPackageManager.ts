import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isRecord } from './typeGuards.ts';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'yarn-berry';

/**
 * Detect the repo's package manager by checking the `packageManager` field in root `package.json`,
 * then falling back to lockfile detection, then defaulting to `npm`.
 *
 * Yarn v2+ is returned as `'yarn-berry'` to distinguish it from Yarn Classic.
 */
export function detectPackageManager(): PackageManager {
  const packageJsonPath = join(process.cwd(), 'package.json');

  try {
    const content = readFileSync(packageJsonPath, 'utf8');
    const parsed: unknown = JSON.parse(content);

    if (isRecord(parsed) && typeof parsed.packageManager === 'string') {
      const [name, version] = parsed.packageManager.split('@');
      if (name === 'pnpm' || name === 'npm') {
        return name;
      }
      if (name === 'yarn') {
        return isYarnBerry(version) ? 'yarn-berry' : 'yarn';
      }
    }
  } catch {
    // Fall through to lockfile detection
  }

  return detectFromLockfile();
}

/** Return true when the version string indicates Yarn v2+. */
function isYarnBerry(version: string | undefined): boolean {
  if (version === undefined) {
    return false;
  }
  const major = Number.parseInt(version, 10);
  return !Number.isNaN(major) && major >= 2;
}

/** Detect the package manager from the presence of lockfiles. */
function detectFromLockfile(): PackageManager {
  const cwd = process.cwd();

  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (existsSync(join(cwd, 'package-lock.json'))) {
    return 'npm';
  }
  if (existsSync(join(cwd, 'yarn.lock'))) {
    return 'yarn';
  }

  return 'npm';
}
