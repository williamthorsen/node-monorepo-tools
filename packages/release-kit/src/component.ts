import { basename } from 'node:path';

import type { ComponentConfig } from './types.ts';

/**
 * Creates a component configuration from a workspace-relative path.
 *
 * Derives all fields from the workspace path so that the same rule governs both
 * tag creation and tag lookup. The `dir` field is the basename of the path; the
 * `tagPrefix` defaults to `${dir}-v`.
 *
 * @param workspacePath - The workspace-relative path (e.g., 'packages/arrays' or 'libs/core').
 * @param tagPrefix - Optional custom tag prefix. Defaults to `${basename}-v`.
 */
export function component(workspacePath: string, tagPrefix?: string): ComponentConfig {
  const dir = basename(workspacePath);
  const prefix = tagPrefix ?? `${dir}-v`;
  return {
    dir,
    tagPrefix: prefix,
    packageFiles: [`${workspacePath}/package.json`],
    changelogPaths: [workspacePath],
    paths: [`${workspacePath}/**`],
  };
}
