import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { chainError } from '@williamthorsen/toolbelt.errors/candidate';

import { isPublishableManifest } from './isPublishableManifest.ts';
import { isRecord } from './typeGuards.ts';
import type { WorkspaceConfig } from './types.ts';

/**
 * Derives a workspace configuration from a workspace-relative path.
 *
 * The tag prefix is `${unscopedName}-v`, from the `name` in the workspace's `package.json`, so that tags follow the
 * package's identity rather than the directory layout. `dir` is the basename of the path: the stable internal
 * identifier for `--only`, config overrides, and dependency-graph lookups.
 */
export function deriveWorkspaceConfig(workspacePath: string): WorkspaceConfig {
  const dir = basename(workspacePath);
  const packageJsonPath = `${workspacePath}/package.json`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  } catch (error) {
    throw chainError(`Failed to read ${packageJsonPath}`, error);
  }
  const name = isRecord(parsed) ? parsed['name'] : undefined;

  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`${packageJsonPath} is missing a 'name' field (required for tag derivation).`);
  }

  const unscopedName = stripNpmScope(name);
  const isPublishable = isPublishableManifest(parsed);

  return {
    dir,
    name,
    tagPrefix: `${unscopedName}-v`,
    workspacePath,
    isPublishable,
    packageFiles: [packageJsonPath],
    changelogPaths: [workspacePath],
    paths: [`${workspacePath}/**`],
  };
}

/**
 * Strips a leading `@scope/` from an npm package name. An npm package name doesn't contain a `/` outside the scope
 * separator, so splitting on the first `/` is safe.
 */
function stripNpmScope(name: string): string {
  if (name.startsWith('@') && name.includes('/')) {
    return name.slice(name.indexOf('/') + 1);
  }
  return name;
}
