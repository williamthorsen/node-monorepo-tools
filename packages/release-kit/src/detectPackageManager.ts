import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isRecord } from './typeGuards.ts';

export type PackageManager = 'npm' | 'pnpm' | 'yarn';

/**
 * Detect the repo's package manager by checking the `packageManager` field in root `package.json`,
 * then falling back to lockfile detection, then defaulting to `npm`.
 */
export function detectPackageManager(): PackageManager {
  const packageJsonPath = join(process.cwd(), 'package.json');

  try {
    const content = readFileSync(packageJsonPath, 'utf8');
    const parsed: unknown = JSON.parse(content);

    if (isRecord(parsed) && typeof parsed.packageManager === 'string') {
      const name = parsed.packageManager.split('@')[0];
      if (name === 'pnpm' || name === 'npm' || name === 'yarn') {
        return name;
      }
    }
  } catch {
    // Fall through to lockfile detection
  }

  return detectFromLockfile();
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
