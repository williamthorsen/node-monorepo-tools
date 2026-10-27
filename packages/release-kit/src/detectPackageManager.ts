import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isRecord } from './typeGuards.ts';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'yarn-berry';

/**
 * Detects the repo's package manager from the `packageManager` field of the root `package.json`, then from lockfiles,
 * and otherwise returns `npm`. Yarn v2+ is `'yarn-berry'`, to distinguish it from Yarn Classic.
 */
export function detectPackageManager(): PackageManager {
  const packageJsonPath = join(process.cwd(), 'package.json');

  try {
    const content = readFileSync(packageJsonPath, 'utf8');
    const parsedJson: unknown = JSON.parse(content);

    if (isRecord(parsedJson) && typeof parsedJson['packageManager'] === 'string') {
      const [name, version] = parsedJson['packageManager'].split('@', 2);
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

/** Reports whether the version string indicates Yarn v2+. */
function isYarnBerry(version: string | undefined): boolean {
  if (version === undefined) {
    return false;
  }
  const majorVersion = Number.parseInt(version, 10);
  return !Number.isNaN(majorVersion) && majorVersion >= 2;
}

/** Detects the package manager from the presence of lockfiles. */
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
