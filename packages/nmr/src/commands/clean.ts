import { rm } from 'node:fs/promises';
import path from 'node:path';

import type { NmrConfig } from '../config.ts';
import { loadConfig } from '../config.ts';
import { findContainingPackageDir } from '../context.ts';
import { applyDevBin, buildWorkspaceRegistry, hasIntegrationTestConfig, resolveScript } from '../resolver.ts';
import { runCommand } from '../runner.ts';
import { findMonorepoRoot, getWorkspacePackageDirs } from '../workspace.ts';
import { resolveBuildCachePath } from './build.ts';

const CLEAN_ICON = '🧹';

/** The command name whose per-package resolution the root sweep honors. */
const CLEAN_COMMAND = 'clean';

/** The default `clean` script: this bin. A package resolving to it is cleaned in-process by the sweep. */
const BUILT_IN_CLEAN = 'nmr-clean';

/**
 * The build-output root a clean removes. `nmr-compile` emits to `dist/esm`, a subdirectory of this
 * root, so removing the root covers the emit wherever it lands inside `dist`.
 */
const OUTPUT_ROOT = 'dist';

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
 * Cleans the package containing `cwd`, or every workspace package when run from the monorepo root.
 *
 * From within a package this is the built-in clean itself: `nmr` has already resolved `clean` to this bin
 * before invoking it, so resolving again would apply the package's own override twice.
 *
 * This is the default `clean` script, shipped as a bin rather than delegating to `rimraf`. Under pnpm's
 * isolated layout, `pnpm exec` resolves only bins of the consuming project's own direct dependencies, so
 * a `rimraf` in nmr's dependency tree would be unreachable — while nmr's own bins are linked into the
 * consumer's `node_modules/.bin`, nmr being a direct dependency.
 */
export async function runClean(cwd: string = process.cwd()): Promise<void> {
  let monorepoRoot: string;
  try {
    monorepoRoot = findMonorepoRoot(cwd);
  } catch {
    // Outside a pnpm workspace there is nothing to sweep; clean the package standing here, as nmr-compile
    // compiles the package standing here.
    await cleanPackage(cwd);
    return;
  }

  const workspacePackageDirs = getWorkspacePackageDirs(monorepoRoot);
  const packageDir = findContainingPackageDir(cwd, workspacePackageDirs);
  if (packageDir !== undefined) {
    await cleanPackage(packageDir);
    return;
  }

  await sweepWorkspace(monorepoRoot, workspacePackageDirs);
}

/**
 * Cleans every workspace package, running each package's resolved `clean` — so a package that overrides
 * `clean`, in config or in its own `package.json`, still gets its own command rather than this sweep.
 *
 * The sweep runs in a single process, and only for the built-in clean. In a repo that builds nmr itself,
 * cleaning removes the very output the `nmr` and `nmr-clean` binaries load from, so re-invoking a binary
 * per package dies partway through and leaves most packages uncleaned; one process resolves its imports
 * up front and is immune to deleting them afterwards. An override is an ordinary command that does not
 * load that output, so spawning it is safe.
 *
 * `devBin` substitution therefore belongs on the spawn path alone, applied to the resolved script only after
 * it is known not to be the built-in: this process is already whichever build `devBin` selects, so rewriting
 * the built-in into a dev binary would spawn the same code per package and forfeit the single-process guarantee.
 */
async function sweepWorkspace(monorepoRoot: string, workspacePackageDirs: string[]): Promise<void> {
  const config: NmrConfig = await loadConfig(monorepoRoot);

  for (const packageDir of workspacePackageDirs) {
    const registry = buildWorkspaceRegistry(config, hasIntegrationTestConfig(packageDir));
    const resolved = resolveScript(CLEAN_COMMAND, registry, packageDir, false);

    // An empty command is the package.json convention for "skip this script".
    if (resolved === undefined || resolved.command === '') {
      continue;
    }

    if (resolved.command === BUILT_IN_CLEAN) {
      await cleanPackage(packageDir);
      continue;
    }

    const command = applyDevBin(resolved.command, config.devBin, monorepoRoot);
    const exitCode = runCommand(command, packageDir);
    if (exitCode !== 0) {
      throw new Error(`nmr-clean: \`${command}\` failed in ${path.basename(packageDir)} with exit code ${exitCode}.`);
    }
  }
}
