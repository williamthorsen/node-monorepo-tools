import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { TempTree } from '@williamthorsen/toolbelt.testing/candidate';

/** The monorepo root, which contains the `node_modules` through which a fixture project resolves Vitest. */
const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

const VITEST_CLI = path.join(REPO_ROOT, 'node_modules/vitest/vitest.mjs');

/** The exact environment names that `buildChildEnv` strips, alongside its `VITEST` and `GIT_CONFIG_` prefixes. */
const STRIPPED_ENV_NAMES = new Set(['GIT_ATTR_NOSYSTEM', 'NODE_V8_COVERAGE', 'TEST']);

/** Runs Vitest once in `cwd`, in a child process of its own. */
export function runVitest(cwd: string, extraArgs: string[] = []): VitestRun {
  return spawnSync(process.execPath, [VITEST_CLI, 'run', ...extraArgs], {
    cwd,
    encoding: 'utf8',
    env: buildChildEnv(),
  });
}

/** Writes the fixture files into `tree` and links the repository's `node_modules` so that Vitest and its coverage provider resolve. */
export function scaffoldProject(tree: TempTree, files: Record<string, string>): void {
  tree.writeAll(files);

  // pnpm's internal links are relative, so they resolve through the link rather than needing an install here.
  tree.symlink('node_modules', path.join(REPO_ROOT, 'node_modules'));
}

/**
 * Unlinks `node_modules`, which is deferred ahead of the tree's own removal so that any failure during that removal
 * cannot affect the repository's own tree. `node:fs`, because `tree.rm` removes with `force`: Were this entry ever
 * a real directory rather than the link, it would be deleted silently, whereas `unlinkSync` throws.
 */
export function unlinkNodeModules(projectRoot: string): void {
  const link = path.join(projectRoot, 'node_modules');
  if (fs.existsSync(link)) fs.unlinkSync(link);
}

/** What one spawned run reports back. */
export interface VitestRun {
  status: number | null;
  stderr: string;
  stdout: string;
}

// region | Helpers

/**
 * Strips the variables that the parent Vitest run exports. Inherited, they leak the parent's worker identity and
 * coverage output directory into the child, which then reports on the wrong run.
 *
 * The git isolation variables are stripped for the same reason: This repo's own suite runs under the isolation that
 * the config supplies, so a child inheriting them observes isolation whether or not the config under test asked for
 * any.
 */
function buildChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const [name, value] of Object.entries(process.env)) {
    if (STRIPPED_ENV_NAMES.has(name)) continue;
    if (name.startsWith('VITEST') || name.startsWith('GIT_CONFIG_')) continue;
    env[name] = value;
  }

  return env;
}

// endregion | Helpers
