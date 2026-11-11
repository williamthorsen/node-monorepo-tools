import fs from 'node:fs';
import path from 'node:path';

import { UserError } from '@williamthorsen/nmr-core';

import { resolveInheritedExitCode, type SpawnInherited, spawnInherited } from './spawn-inherited.ts';
import { ensureTool, resolveToolCacheRoots, type WorkflowTool } from './workflow-tools.ts';

export interface RunActionlintOptions {
  /** Directories under which the pinned tools are cached, in lookup order; defaults to `resolveToolCacheRoots`. */
  cacheRoots?: readonly [string, ...string[]];
  ensure?: (tool: WorkflowTool, cacheRoots: readonly [string, ...string[]]) => Promise<string>;
  spawn?: SpawnInherited;
}

/** The directory, relative to the monorepo root, whose workflows actionlint lints. */
const WORKFLOWS_DIR = path.join('.github', 'workflows');

/**
 * Lints the monorepo's GitHub Actions workflows with the pinned actionlint, running its shellcheck pass with the
 * pinned shellcheck, and returns actionlint's exit status. A repo without a workflows directory passes.
 */
export async function runActionlint(
  monorepoRoot: string,
  args: readonly string[],
  options: RunActionlintOptions = {},
): Promise<number> {
  if (!fs.existsSync(path.join(monorepoRoot, WORKFLOWS_DIR))) {
    console.info(`No workflows to lint: ${WORKFLOWS_DIR}/ does not exist.`);
    return 0;
  }

  const cacheRoots = options.cacheRoots ?? resolveToolCacheRoots(monorepoRoot);
  const ensure = options.ensure ?? ((tool, roots) => ensureTool(tool, { cacheRoots: roots }));
  const actionlintPath = await ensure('actionlint', cacheRoots);
  const shellcheckPath = await ensure('shellcheck', cacheRoots);

  const outcome = (options.spawn ?? spawnInherited)(actionlintPath, buildActionlintArgs(shellcheckPath, args), {
    cwd: monorepoRoot,
  });
  if (outcome.error !== undefined) {
    throw new UserError(`Cannot run actionlint: ${outcome.error.message}`, { cause: outcome.error });
  }
  return resolveInheritedExitCode(outcome);
}

/**
 * Builds actionlint's arguments. The pyflakes integration is disabled so that the result does not depend on whether
 * the machine happens to have pyflakes on `PATH`.
 */
export function buildActionlintArgs(shellcheckPath: string, args: readonly string[]): string[] {
  return [`-shellcheck=${shellcheckPath}`, '-pyflakes=', ...args];
}
