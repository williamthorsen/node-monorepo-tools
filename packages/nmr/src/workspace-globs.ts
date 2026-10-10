import path from 'node:path';

/**
 * Renders each package directory as a glob, relative to `monorepoRoot`, that matches everything beneath it, sorted. A
 * directory that is the root itself is skipped, since its glob would match the whole repo.
 */
export function toWorkspacePackageGlobs(monorepoRoot: string, packageDirs: readonly string[]): string[] {
  return packageDirs
    .map((dir) => path.relative(monorepoRoot, dir).split(path.sep).join('/'))
    .filter((relativeDir) => relativeDir !== '')
    .map((relativeDir) => `${relativeDir}/**`)
    .toSorted();
}
