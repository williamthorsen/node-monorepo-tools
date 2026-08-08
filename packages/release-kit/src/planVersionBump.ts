import { readFileSync } from 'node:fs';

import { bumpVersion } from './bumpVersion.ts';
import type { PlannedWrite } from './releasePlan.ts';
import type { ReleaseType } from './types.ts';

interface PackageJson {
  [key: string]: unknown;
  version: string;
}

/** A version change computed for a workspace's package files but not yet written. */
export interface VersionBumpPlan {
  currentVersion: string;
  newVersion: string;
  writes: PlannedWrite[];
}

function isPackageJson(value: unknown): value is PackageJson {
  return typeof value === 'object' && value !== null && 'version' in value && typeof value.version === 'string';
}

/**
 * Computes the version bump for a workspace's package files without writing them.
 *
 * The current version comes from the first package file, and the new one from the release type.
 * Every file's post-bump content is rendered in full, preserving the fields the file already
 * carries and the two-space indentation with a trailing newline.
 */
export function planVersionBump(packageFiles: readonly string[], releaseType: ReleaseType): VersionBumpPlan {
  const { firstFile, firstPkg } = readPrimaryPackage(packageFiles);
  const currentVersion = firstPkg.version;
  const newVersion = bumpVersion(currentVersion, releaseType);

  return { currentVersion, newVersion, writes: renderVersionWrites(packageFiles, firstFile, firstPkg, newVersion) };
}

/**
 * Computes an explicit version assignment for a workspace's package files without writing them,
 * bypassing commit-derived bump logic. Backs the `--set-version` flag.
 */
export function planVersionSet(packageFiles: readonly string[], newVersion: string): VersionBumpPlan {
  const { firstFile, firstPkg } = readPrimaryPackage(packageFiles);
  const currentVersion = firstPkg.version;

  return { currentVersion, newVersion, writes: renderVersionWrites(packageFiles, firstFile, firstPkg, newVersion) };
}

/**
 * Reads the first package file, which supplies the pre-change version for the whole workspace.
 *
 * @throws If no package files are configured.
 */
function readPrimaryPackage(packageFiles: readonly string[]): { firstFile: string; firstPkg: PackageJson } {
  const firstFile = packageFiles[0];
  if (firstFile === undefined) {
    throw new Error('No package files specified');
  }

  return { firstFile, firstPkg: readPackageJson(firstFile) };
}

/** Renders each package file's complete content with `version` set to `newVersion`. */
function renderVersionWrites(
  packageFiles: readonly string[],
  firstFile: string,
  firstPkg: PackageJson,
  newVersion: string,
): PlannedWrite[] {
  return packageFiles.map((filePath) => {
    const pkg = filePath === firstFile ? firstPkg : readPackageJson(filePath);
    pkg.version = newVersion;

    return { path: filePath, content: JSON.stringify(pkg, null, 2) + '\n' };
  });
}

/**
 * Read and parse a package.json file, returning a validated object with a `version` field.
 *
 * @throws If the file cannot be read, contains invalid JSON, or lacks a `version` field.
 */
function readPackageJson(filePath: string): PackageJson {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (error: unknown) {
    throw new Error(`Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    throw new Error(`Failed to parse JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }

  if (!isPackageJson(parsed)) {
    throw new Error(`No valid 'version' field found in ${filePath}`);
  }

  return parsed;
}
