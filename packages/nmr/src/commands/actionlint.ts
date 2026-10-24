import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { describeSignalExitCode } from '../child-process.ts';
import { ensureTool, type WorkflowTool } from './workflow-tools.ts';

/** How a spawned actionlint ended. */
export interface ActionlintOutcome {
  error?: Error | undefined;
  signal: NodeJS.Signals | null;
  status: number | null;
}

export interface RunActionlintOptions {
  /** Directory under which the pinned tools are cached; defaults to `node_modules/.cache/nmr-tools` at the root. */
  cacheRoot?: string;
  ensure?: (tool: WorkflowTool, cacheRoot: string) => Promise<string>;
  spawn?: (file: string, args: string[], cwd: string) => ActionlintOutcome;
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

  const cacheRoot = options.cacheRoot ?? path.join(monorepoRoot, 'node_modules', '.cache', 'nmr-tools');
  const ensure = options.ensure ?? ((tool, root) => ensureTool(tool, { cacheRoot: root }));
  const actionlintPath = await ensure('actionlint', cacheRoot);
  const shellcheckPath = await ensure('shellcheck', cacheRoot);

  const outcome = (options.spawn ?? spawnInherited)(
    actionlintPath,
    buildActionlintArgs(shellcheckPath, args),
    monorepoRoot,
  );
  if (outcome.error !== undefined) {
    throw new Error(`Cannot run actionlint: ${outcome.error.message}`, { cause: outcome.error });
  }
  if (outcome.signal !== null) {
    return describeSignalExitCode(outcome.signal);
  }
  return outcome.status ?? 1;
}

/**
 * Builds actionlint's arguments. The pyflakes integration is disabled so that the result does not depend on whether
 * the machine happens to have pyflakes on `PATH`.
 */
export function buildActionlintArgs(shellcheckPath: string, args: readonly string[]): string[] {
  return [`-shellcheck=${shellcheckPath}`, '-pyflakes=', ...args];
}

// region | Helpers

/** Runs a program on the caller's terminal, so that actionlint colors its findings when stdout is one. */
function spawnInherited(file: string, args: string[], cwd: string): ActionlintOutcome {
  const result = spawnSync(file, args, { cwd, stdio: 'inherit' });
  return { error: result.error, signal: result.signal, status: result.status };
}

// endregion | Helpers
