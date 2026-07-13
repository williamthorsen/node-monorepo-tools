import { rm } from 'node:fs/promises';
import path from 'node:path';

import { resolveBuildCachePath } from './build.ts';

const CLEAN_ICON = '🧹';

/**
 * The build-output root a clean removes. `nmr-compile` emits to `dist/esm`, a subdirectory of this
 * root, so removing the root covers the emit wherever it lands inside `dist`.
 */
const OUTPUT_ROOT = 'dist';

/**
 * Removes a package's build output and the build-cache entry that describes it, so no state survives
 * to make the next build skip. Removal is idempotent: an already-clean package is a silent no-op.
 *
 * This is the default `clean` script, shipped as a bin rather than delegating to `rimraf`. Under pnpm's
 * isolated layout, `pnpm exec` only finds bins of the consuming project's own direct dependencies, so a
 * `rimraf` in nmr's dependency tree would be unreachable — while nmr's own bins, nmr being a direct
 * dependency, are linked into the consumer's `node_modules/.bin`.
 */
export async function cleanPackage(packageDir: string): Promise<void> {
  await rm(path.resolve(packageDir, OUTPUT_ROOT), { recursive: true, force: true });
  await rm(resolveBuildCachePath(packageDir), { force: true });

  console.info(`${CLEAN_ICON} ${path.basename(packageDir)}: Removed build output and cache.`);
}
