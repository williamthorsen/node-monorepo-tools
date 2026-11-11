import fs from 'node:fs';
import path from 'node:path';

import { runGit, UserError } from '@williamthorsen/nmr-core';

import { resolveInheritedExitCode, type SpawnInherited, spawnInherited } from './spawn-inherited.ts';
import { ensureTool, resolveToolCacheRoots, type WorkflowTool } from './workflow-tools.ts';

export interface RunShellcheckOptions {
  /** Directories under which the pinned tools are cached, in lookup order; defaults to `resolveToolCacheRoots`. */
  cacheRoots?: readonly [string, ...string[]];
  ensure?: (tool: WorkflowTool, cacheRoots: readonly [string, ...string[]]) => Promise<string>;
  /** Lists the tracked `*.sh` files under the root, relative to it. */
  listFiles?: (monorepoRoot: string) => string[];
  spawn?: SpawnInherited;
}

/**
 * Lints the monorepo's tracked shell scripts with the pinned shellcheck and returns its exit status. Trailing
 * arguments replace the file list. A repo that does not track any `*.sh` file passes without fetching the tool.
 */
export async function runShellcheck(
  monorepoRoot: string,
  args: readonly string[],
  options: RunShellcheckOptions = {},
): Promise<number> {
  const shellcheckArgs = args.length > 0 ? [...args] : listPresentScripts(monorepoRoot, options.listFiles);
  if (shellcheckArgs.length === 0) {
    console.info('No shell scripts to lint: the working tree does not contain any tracked *.sh file.');
    return 0;
  }

  const cacheRoots = options.cacheRoots ?? resolveToolCacheRoots(monorepoRoot);
  const ensure = options.ensure ?? ((tool, roots) => ensureTool(tool, { cacheRoots: roots }));
  const shellcheckPath = await ensure('shellcheck', cacheRoots);

  const outcome = (options.spawn ?? spawnInherited)(shellcheckPath, shellcheckArgs, { cwd: monorepoRoot });
  if (outcome.error !== undefined) {
    throw new UserError(`Cannot run shellcheck: ${outcome.error.message}`, { cause: outcome.error });
  }
  return resolveInheritedExitCode(outcome);
}

/**
 * Lists the `*.sh` files that git tracks under the root, relative to it. git's `*` also matches `/`, so the pathspec
 * reaches every directory.
 */
export function listTrackedScripts(monorepoRoot: string): string[] {
  const result = runGit(['ls-files', '-z', '--', '*.sh'], monorepoRoot);
  if (!result.ok) {
    throw new UserError(`Cannot list tracked shell scripts: ${result.error}`);
  }
  return result.stdout.split('\0').filter((file) => file !== '');
}

// region | Helpers

/** Lists the tracked scripts that exist on disk, so that a deletion not yet staged does not fail the run. */
function listPresentScripts(monorepoRoot: string, listFiles = listTrackedScripts): string[] {
  return listFiles(monorepoRoot).filter((file) => fs.existsSync(path.join(monorepoRoot, file)));
}

// endregion | Helpers
