import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { chainError } from '@williamthorsen/toolbelt.errors/candidate';

import type { DeclaredDirectory } from './resolveReleaseDeclaration.ts';
import { isRecord } from './typeGuards.ts';
import type { DirectoryConfig } from './types.ts';

/** Name of the version file of a directory that doesn't contain a `package.json`. */
export const DIRECTORY_VERSION_FILE = 'version.json';

/** Characters that a derived tag prefix may contain, so that every tag under it is a valid git ref name. */
const TAG_PREFIX_PATTERN = /^[\w.-]+$/;

/**
 * Derives a directory target's configuration from its declaration, reading the directory under `root`.
 *
 * The version file is the directory's `package.json` when it has one, and its `version.json` otherwise; either must
 * contain a string `version`. The tag prefix defaults to the directory's basename followed by `-v`, and to `v` for the
 * repo root. Throws when the path isn't a directory, when the version file is missing or lacks a `version`, and when
 * the basename would not make a valid tag prefix.
 */
export function deriveDirectoryConfig(
  declaredDirectory: DeclaredDirectory,
  root: string = process.cwd(),
): DirectoryConfig {
  const label = `releases.${declaredDirectory.name}`;
  if (statSync(path.resolve(root, declaredDirectory.path), { throwIfNoEntry: false })?.isDirectory() !== true) {
    throw new Error(
      `${label}: path '${declaredDirectory.path}' is not a directory; declare a directory that exists in the repo`,
    );
  }

  const versionFile = resolveVersionFile(declaredDirectory.path, root);
  assertVersionField(label, versionFile, root);

  const config: DirectoryConfig = {
    name: declaredDirectory.name,
    path: declaredDirectory.path,
    versionFile,
    tagPrefix: declaredDirectory.tagPrefix ?? deriveTagPrefix(label, declaredDirectory.path),
  };
  if (declaredDirectory.paths !== undefined) {
    config.paths = [...declaredDirectory.paths];
  }
  if (declaredDirectory.legacyIdentities !== undefined) {
    config.legacyIdentities = declaredDirectory.legacyIdentities;
  }
  return config;
}

// region | Helpers

/** Throws unless the version file exists and contains a string `version`, naming the file to create or repair. */
function assertVersionField(label: string, versionFile: string, root: string): void {
  const absolutePath = path.resolve(root, versionFile);
  if (!existsSync(absolutePath)) {
    throw new Error(
      `${label}: ${versionFile} not found; create it with the directory's current version, such as { "version": "0.0.0" }`,
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch (error: unknown) {
    throw chainError(`${label}: failed to read ${versionFile}`, error);
  }
  if (!isRecord(parsedJson) || typeof parsedJson['version'] !== 'string') {
    throw new Error(`${label}: ${versionFile} does not contain a string 'version' field; add one`);
  }
}

/** Returns the default tag prefix of a directory, `v` for the repo root; throws when its basename can't form one. */
function deriveTagPrefix(label: string, directoryPath: string): string {
  if (directoryPath === '.') {
    return 'v';
  }
  const basename = path.posix.basename(directoryPath);
  if (!TAG_PREFIX_PATTERN.test(basename)) {
    throw new Error(
      `${label}: the directory name '${basename}' cannot form a tag prefix; set tagPrefix, such as '${basename.replaceAll(/[^\w.-]+/g, '-')}-v'`,
    );
  }
  return `${basename}-v`;
}

/** Returns the repo-relative version file of a directory: its `package.json` when present, else its `version.json`. */
function resolveVersionFile(directoryPath: string, root: string): string {
  const packageJsonPath = path.posix.join(directoryPath, 'package.json');
  return existsSync(path.resolve(root, packageJsonPath))
    ? packageJsonPath
    : path.posix.join(directoryPath, DIRECTORY_VERSION_FILE);
}

// endregion | Helpers
