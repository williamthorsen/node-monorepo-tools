import { readFileSync, writeFileSync } from 'node:fs';

import { bumpVersion } from './bumpVersion.ts';
import type { ReleaseType } from './types.ts';

interface PackageJson {
  version: string;
  [key: string]: unknown;
}

function isPackageJson(value: unknown): value is PackageJson {
  return typeof value === 'object' && value !== null && 'version' in value && typeof value.version === 'string';
}

/**
 * Bumps the version field in all specified package.json files.
 *
 * Reads each file, parses the JSON, bumps the `version` field, and writes
 * the result back with the original formatting (2-space indentation, trailing newline).
 *
 * @param packageFiles - Paths to package.json files to bump.
 * @param releaseType - The semver release type to apply.
 * @param dryRun - If true, logs the changes without writing to disk.
 * @returns The new version string after bumping.
 * @throws If any package.json does not contain a valid `version` field.
 */
export function bumpAllVersions(packageFiles: readonly string[], releaseType: ReleaseType, dryRun: boolean): string {
  const firstFile = packageFiles[0];
  if (firstFile === undefined) {
    throw new Error('No package files specified');
  }

  const firstPkg = readPackageJson(firstFile);
  const currentVersion = firstPkg.version;
  const newVersion = bumpVersion(currentVersion, releaseType);
  console.info(`Bumping version: ${currentVersion} -> ${newVersion} (${releaseType})`);

  for (const filePath of packageFiles) {
    if (dryRun) {
      console.info(`  [dry-run] Would bump ${filePath}`);
      continue;
    }

    const pkg = filePath === firstFile ? firstPkg : readPackageJson(filePath);
    pkg.version = newVersion;

    try {
      writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    } catch (error: unknown) {
      throw new Error(`Failed to write ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    console.info(`  Bumped ${filePath}`);
  }

  return newVersion;
}

/**
 * Reads and parses a package.json file, returning a validated object with a `version` field.
 *
 * @throws If the file cannot be read, contains invalid JSON, or lacks a `version` field.
 */
function readPackageJson(filePath: string): PackageJson {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (error: unknown) {
    throw new Error(`Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    throw new Error(`Failed to parse JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isPackageJson(parsed)) {
    throw new Error(`No valid 'version' field found in ${filePath}`);
  }

  return parsed;
}
