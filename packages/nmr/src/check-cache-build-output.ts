import path from 'node:path';

import { hasBuildOutput, readBuildDigest } from './commands/build-output.ts';
import { loadWorkspaceConfig } from './config.ts';
import { getDefaultWorkspaceScripts, type ScriptRegistry } from './resolve-scripts.ts';
import { buildWorkspaceRegistry, resolveScript } from './resolver.ts';
import { renderChain } from './steps.ts';
import type { NmrConfig } from './types.ts';
import { getWorkspacePackageDirs } from './workspace.ts';

/** What nmr's own build has left on disk across the workspace. */
export interface BuildOutputState {
  /** Covered packages whose output is absent. */
  missingPackages: string[];
  /** The digest of the inputs from which each covered package's output was built, keyed by package name. */
  digests: Record<string, string>;
}

/** The default `compile` script: nmr's own build. */
const BUILT_IN_COMPILE = 'nmr-compile';

/**
 * Names a covered package whose output differs between two observations of it, or `undefined` when every
 * package agrees. A package that has appeared or disappeared between them counts as a disagreement, because
 * the output that the earlier observation describes is not the output that the later one found.
 */
export function findStaleBuildOutput(
  earlierDigests: Record<string, string>,
  laterDigests: Record<string, string>,
): string | undefined {
  const names = [...new Set([...Object.keys(earlierDigests), ...Object.keys(laterDigests)])].toSorted();

  return names.find((name) => earlierDigests[name] !== laterDigests[name]);
}

/**
 * Reads the state of the build output that nmr's own build covers. Build output is git-ignored, so the tree id
 * says nothing about it: a `ci` whose `build` constituent is cached would otherwise skip on a tree whose `dist`
 * had been deleted, or whose `dist` was compiled from a different tree, and hand back a green exit over a
 * repository that cannot run.
 *
 * Because a package whose `build` or `compile` is overridden emits to a location that this function does not
 * know about, it is left out rather than made a permanent miss.
 */
export async function readBuildOutputState(monorepoRoot: string, config: NmrConfig): Promise<BuildOutputState> {
  const state: BuildOutputState = { missingPackages: [], digests: {} };

  let packageDirs: string[];
  try {
    packageDirs = getWorkspacePackageDirs(monorepoRoot);
  } catch {
    return state;
  }

  const registry = buildWorkspaceRegistry(config);
  // Return before reading any package: a repo that redefines `build` exempts its whole workspace.
  if (JSON.stringify(registry['build']) !== JSON.stringify(getDefaultWorkspaceScripts()['build'])) {
    return state;
  }

  for (const packageDir of packageDirs) {
    if (!isProbeSubject(packageDir, registry)) {
      continue;
    }

    // Read on the package's own build options, so that the entry set here is the one that the build actually
    // compiles. A package whose extra patterns leave nothing to emit does not expect any output, and reporting
    // it missing would make it a permanent miss that defeats the whole repo's gate.
    const { build } = await loadWorkspaceConfig(packageDir);
    const options = build?.extraIgnorePatterns === undefined ? {} : { extraIgnorePatterns: build.extraIgnorePatterns };

    // Key by the path relative to the monorepo root, the identity that `computeCacheKey` uses for a scope: a
    // workspace's globs can yield two packages with the same directory name, and each needs its own digest.
    const name = path.relative(monorepoRoot, packageDir);
    if (await hasBuildOutput(packageDir, options)) {
      state.digests[name] = (await readBuildDigest(packageDir)) ?? '';
    } else {
      state.missingPackages.push(name);
    }
  }

  return state;
}

// region | Helpers

/**
 * Reports whether a package's build output is nmr's own to look for: neither its `build` nor its `compile` is
 * overridden by the package itself. If either is overridden, the package emits output in a way that this
 * function does not know, so demanding a `dist` would make every run a miss.
 */
function isProbeSubject(packageDir: string, registry: ScriptRegistry): boolean {
  const build = resolveScript('build', registry, packageDir, false);
  if (build === undefined || build.origin.tier === 'package') {
    return false;
  }

  const compile = resolveScript('compile', registry, packageDir, false);

  return compile !== undefined && renderChain(compile.steps) === BUILT_IN_COMPILE;
}

// endregion | Helpers
