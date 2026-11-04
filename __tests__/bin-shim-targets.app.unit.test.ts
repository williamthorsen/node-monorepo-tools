import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { findMonorepoRoot, getWorkspacePackageDirs } from '@williamthorsen/nmr/workspace';
import { describe, expect, it } from 'vitest';

/** Captures the module path, relative to `dist/esm`, that a shim imports. */
const SHIM_TARGET_PATTERN = /import\('\.\.\/dist\/esm\/(?<modulePath>[^']+)\.js'\)/;

const monorepoRoot = findMonorepoRoot(import.meta.dirname);

/**
 * Guards against a `bin` shim that imports a built module whose source does not exist. A shim imports its entry by
 * path, so moving or renaming the entry without updating the shim leaves an installed CLI that fails at launch, or one
 * that loads a stale build output and does nothing.
 */
describe('every bin shim imports a module that has a source file', () => {
  const shims = getWorkspacePackageDirs(monorepoRoot).flatMap(listShims);

  it('finds shims to check', () => {
    expect(shims.length).toBeGreaterThan(0);
  });

  it.each(shims.map((shim) => [`${shim.packageName}: ${shim.binName}`, shim] as const))('%s', (_label, shim) => {
    const sourcePath = path.join(shim.packageDir, 'src', `${readShimTarget(shim.shimPath)}.ts`);
    expect(existsSync(sourcePath), `${path.relative(monorepoRoot, sourcePath)} is missing`).toBe(true);
  });
});

// region | Helpers
interface Shim {
  binName: string;
  packageDir: string;
  packageName: string;
  shimPath: string;
}

/** Reports whether a value is a non-null object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Lists the shims that a package's manifest declares under `bin`, in either its string or its object form. */
function listShims(packageDir: string): Shim[] {
  const manifest: unknown = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  if (!isRecord(manifest)) return [];

  const packageName = typeof manifest['name'] === 'string' ? manifest['name'] : path.basename(packageDir);
  const { bin } = manifest;
  if (typeof bin === 'string') {
    return [{ binName: packageName, packageDir, packageName, shimPath: path.join(packageDir, bin) }];
  }
  if (!isRecord(bin)) return [];

  return Object.entries(bin)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([binName, relativePath]) => ({
      binName,
      packageDir,
      packageName,
      shimPath: path.join(packageDir, relativePath),
    }));
}

/** Returns the module path, relative to `dist/esm` and without its extension, that a shim imports. */
function readShimTarget(shimPath: string): string {
  const modulePath = SHIM_TARGET_PATTERN.exec(readFileSync(shimPath, 'utf8'))?.groups?.['modulePath'];
  if (modulePath === undefined) {
    throw new Error(`${path.relative(monorepoRoot, shimPath)} does not import a module from ../dist/esm`);
  }
  return modulePath;
}
// endregion | Helpers
