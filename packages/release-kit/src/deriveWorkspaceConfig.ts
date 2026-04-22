import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { isRecord } from './typeGuards.ts';
import type { WorkspaceConfig } from './types.ts';

/**
 * Derives a workspace configuration from a workspace-relative path.
 *
 * Reads `package.json` at the workspace path to derive the tag identifier from the
 * package's `name` field (with any leading `@scope/` stripped). The `dir` field remains
 * the basename of the path — it is the stable internal identifier used for `--only`,
 * config overrides, and dependency-graph lookups. The `tagPrefix` is `${unscopedName}-v`,
 * so tags reflect the package identity rather than the directory layout.
 */
export function deriveWorkspaceConfig(workspacePath: string): WorkspaceConfig {
  const dir = basename(workspacePath);
  const packageJsonPath = `${workspacePath}/package.json`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${packageJsonPath}: ${message}`);
  }
  const name = isRecord(parsed) ? parsed.name : undefined;

  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`${packageJsonPath} is missing a 'name' field (required for tag derivation).`);
  }

  const unscopedName = stripNpmScope(name);

  return {
    dir,
    tagPrefix: `${unscopedName}-v`,
    workspacePath,
    packageFiles: [packageJsonPath],
    changelogPaths: [workspacePath],
    paths: [`${workspacePath}/**`],
  };
}

/**
 * Strip a leading `@scope/` from an npm package name.
 *
 * Npm package names cannot contain `/` outside the scope separator, so splitting on
 * the first `/` is safe. Intentionally scoped to this module because the concept is
 * distinct from the commit-scope stripping performed by `stripScope.ts`.
 */
function stripNpmScope(name: string): string {
  if (name.startsWith('@') && name.includes('/')) {
    return name.slice(name.indexOf('/') + 1);
  }
  return name;
}
