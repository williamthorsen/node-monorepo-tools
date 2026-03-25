import { basename } from 'node:path';

import type { ComponentConfig } from './types.ts';

/**
 * Creates a component configuration from a workspace-relative path.
 *
 * Derives all fields from the workspace path so that the same rule governs both
 * tag creation and tag lookup. The `dir` field is the basename of the path; the
 * `tagPrefix` is always `${dir}-v`.
 */
export function component(workspacePath: string): ComponentConfig {
  const dir = basename(workspacePath);
  return {
    dir,
    tagPrefix: `${dir}-v`,
    packageFiles: [`${workspacePath}/package.json`],
    changelogPaths: [workspacePath],
    paths: [`${workspacePath}/**`],
  };
}
