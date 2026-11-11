import path from 'node:path';
import { PassThrough } from 'node:stream';

import type { TempTree } from '@williamthorsen/toolbelt.testing/candidate';

import { writeCheckCacheEntry } from '../../check-cache/check-cache-entries.ts';
import { resolveBuildCachePath, resolveEmitDurationPath } from '../build-output.ts';
import { cleanFrom, type CleanOutcome, type CleanProgress } from '../clean.ts';

/** Runs `cleanFrom` against throwaway streams and returns its outcome with the progress that it reported. */
export async function cleanCollecting(cwd: string): Promise<{ outcome: CleanOutcome; progress: CleanProgress[] }> {
  const progress: CleanProgress[] = [];
  const outcome = await cleanFrom(cwd, {
    onProgress: (event) => {
      progress.push(event);
    },
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
  return { outcome, progress };
}

/** Returns true if the `dist` directory exists. */
export function hasOutput(tree: TempTree, packageEntry: string): boolean {
  return tree.exists(`${packageEntry}/dist`);
}

/** Records a check result, standing in for a green run at that scope. */
export async function recordCheckResult(monorepoRoot: string, anchorDir: string, command: string): Promise<void> {
  await writeCheckCacheEntry({
    monorepoRoot,
    anchorDir,
    command,
    entry: {
      key: 'a-key',
      treeHash: 'a-tree-hash',
      headSha: 'a-head-sha',
      commandString: `nmr ${command}`,
      nmrVersion: '1.0.0',
      nodeVersion: 'v24.0.0',
      durationMs: 1000,
      recordedAt: '2026-08-02T12:00:00.000Z',
      buildDigests: {},
    },
  });
}

/** Resolves the package's build-cache entry, relative to the tree: The store returns the absolute path that it keys. */
export function resolveCacheEntry(tree: TempTree, packageEntry: string): string {
  return path.relative(tree.dir, resolveBuildCachePath(tree.resolve(packageEntry)));
}

/** Resolves a package's emit-duration entry relative to the tree, for the tree's path-based helpers. */
export function resolveDurationEntry(tree: TempTree, packageEntry: string): string {
  return path.relative(tree.dir, resolveEmitDurationPath(tree.resolve(packageEntry)));
}

/** Writes a package that looks freshly built: sources, emitted output, and both build-cache entries. */
export function scaffoldBuiltPackage(tree: TempTree, packageEntry: string): void {
  tree.writeAll({
    [`${packageEntry}/dist/esm/index.js`]: 'export const value = 1;\n',
    [`${packageEntry}/node_modules/`]: '',
    [`${packageEntry}/package.json`]: JSON.stringify({ name: 'fixture', type: 'module' }),
    [`${packageEntry}/src/index.ts`]: 'export const value = 1;\n',
  });
  tree.write(resolveCacheEntry(tree, packageEntry), 'a-stale-digest');
  tree.writeJson(resolveDurationEntry(tree, packageEntry), { token: 'a-stale-digest', value: { emitMs: 2100 } });
}

/** Writes a pnpm workspace root containing two built packages, and returns their tree-relative entries. */
export function scaffoldWorkspace(tree: TempTree): { aDir: string; bDir: string } {
  tree.writeAll({
    'package.json': JSON.stringify({ name: 'root', type: 'module' }),
    'pnpm-workspace.yaml': 'packages:\n  - "packages/*"\n',
  });

  const aDir = 'packages/a';
  const bDir = 'packages/b';
  scaffoldBuiltPackage(tree, aDir);
  scaffoldBuiltPackage(tree, bDir);
  return { aDir, bDir };
}
