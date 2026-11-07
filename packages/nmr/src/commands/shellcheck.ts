import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { runGit, UserError } from '@williamthorsen/nmr-core';

import { describeSignalExitCode } from '../child-process.ts';
import { ensureTool, type WorkflowTool } from './workflow-tools.ts';

/** How a spawned shellcheck ended. */
export interface ShellcheckOutcome {
  error?: Error | undefined;
  signal: NodeJS.Signals | null;
  status: number | null;
}

export interface RunShellcheckOptions {
  /** Directory under which the pinned tools are cached; defaults to `node_modules/.cache/nmr-tools` at the root. */
  cacheRoot?: string;
  ensure?: (tool: WorkflowTool, cacheRoot: string) => Promise<string>;
  /** Lists the tracked `*.sh` files under the root, relative to it. */
  listFiles?: (monorepoRoot: string) => string[];
  spawn?: (file: string, args: string[], cwd: string) => ShellcheckOutcome;
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

  const cacheRoot = options.cacheRoot ?? path.join(monorepoRoot, 'node_modules', '.cache', 'nmr-tools');
  const ensure = options.ensure ?? ((tool, root) => ensureTool(tool, { cacheRoot: root }));
  const shellcheckPath = await ensure('shellcheck', cacheRoot);

  const outcome = (options.spawn ?? spawnInherited)(shellcheckPath, shellcheckArgs, monorepoRoot);
  if (outcome.error !== undefined) {
    throw new UserError(`Cannot run shellcheck: ${outcome.error.message}`, { cause: outcome.error });
  }
  if (outcome.signal !== null) {
    return describeSignalExitCode(outcome.signal);
  }
  return outcome.status ?? 1;
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

/** Runs a program on the caller's terminal, so that shellcheck colors its findings when stdout is one. */
function spawnInherited(file: string, args: string[], cwd: string): ShellcheckOutcome {
  const result = spawnSync(file, args, { cwd, stdio: 'inherit' });
  return { error: result.error, signal: result.signal, status: result.status };
}

// endregion | Helpers
