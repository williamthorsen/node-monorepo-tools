import { rm } from 'node:fs/promises';
import path from 'node:path';

import { resolveBuildCachePath } from './build.ts';
import { findContainingPackageDir, findMonorepoRoot, getWorkspacePackageDirs } from '../context.ts';

const CLEAN_ICON = '🧹';

/**
 * The build-output root a clean removes. `nmr-compile` emits to `dist/esm`, a subdirectory of this
 * root, so removing the root covers the emit wherever it lands inside `dist`.
 */
const OUTPUT_ROOT = 'dist';

/**
 * Cleans the package containing `cwd`, or every workspace package when run from the monorepo root.
 *
 * The root clean runs in a single process rather than re-invoking a binary per package. In a repo that
 * builds nmr itself, cleaning removes the very output the `nmr` and `nmr-clean` binaries load from, so
 * any per-package re-spawn dies partway through the sweep — leaving most packages uncleaned. One process
 * resolves its imports up front and is immune to deleting them afterwards.
 *
 * This is the default `clean` script, shipped as a bin rather than delegating to `rimraf`. Under pnpm's
 * isolated layout, `pnpm exec` resolves only bins of the consuming project's own direct dependencies, so
 * a `rimraf` in nmr's dependency tree would be unreachable — while nmr's own bins are linked into the
 * consumer's `node_modules/.bin`, nmr being a direct dependency.
 */
export async function runClean(cwd: string = process.cwd()): Promise<void> {
  for (const packageDir of resolveCleanTargets(cwd)) {
    await cleanPackage(packageDir);
  }
}

/**
 * Removes a package's build output and the build-cache entry that describes it, so no state survives to
 * make the next build skip. Removal is idempotent: an already-clean package is a silent no-op.
 */
export async function cleanPackage(packageDir: string): Promise<void> {
  await rm(path.resolve(packageDir, OUTPUT_ROOT), { recursive: true, force: true });
  await rm(resolveBuildCachePath(packageDir), { force: true });

  console.info(`${CLEAN_ICON} ${path.basename(packageDir)}: Removed build output and cache.`);
}

/**
 * Resolves which packages a clean covers: every workspace package from the monorepo root, or the single
 * containing package from within one. Outside a pnpm workspace it falls back to the current directory,
 * so the bin stays usable on a standalone package — the same context-free footing as `nmr-compile`.
 */
function resolveCleanTargets(cwd: string): string[] {
  let monorepoRoot: string;
  try {
    monorepoRoot = findMonorepoRoot(cwd);
  } catch {
    return [cwd];
  }

  const workspacePackageDirs = getWorkspacePackageDirs(monorepoRoot);
  const packageDir = findContainingPackageDir(cwd, workspacePackageDirs);
  return packageDir === undefined ? workspacePackageDirs : [packageDir];
}
