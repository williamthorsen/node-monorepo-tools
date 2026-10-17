import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import type { TempTree } from '@williamthorsen/toolbelt.testing/candidate';

import { type CheckCacheEntry, readCheckCacheEntry } from '../check-cache-entries.ts';
import { resolveBuildCachePath } from '../commands/build-output.ts';
import type { ScriptValue } from '../resolve-scripts.ts';
import { runCli } from '../runCli.ts';
import { readAmbientEnv } from './readAmbientEnv.ts';

/** The cacheable command driven by every test; the fixture maps it to a script whose runs are countable. */
export const COMMAND = 'typecheck';

/** The run log, which is beside the repository rather than inside it. */
export const LOG_ENTRY = 'log.txt';

/** Counts the entries that the cache currently stores for the fixture repository. */
export function countCacheEntries(workspace: TempTree): number {
  const cacheDir = 'repo/node_modules/.cache/nmr-check';
  return workspace.exists(cacheDir) ? workspace.list(cacheDir).length : 0;
}

/** Counts how many times the fixture's command has actually run. */
export function countRuns(workspace: TempTree): number {
  return readLog(workspace).length;
}

/** Reads the entry that the fixture's runs record for the cacheable command at the repository root. */
export async function readEntry(repo: string): Promise<CheckCacheEntry | undefined> {
  return readCheckCacheEntry({ anchorDir: repo, command: COMMAND, monorepoRoot: repo });
}

/** Returns the lines appended by the fixture's scripts, one per run. */
export function readLog(workspace: TempTree): string[] {
  if (!workspace.exists(LOG_ENTRY)) {
    return [];
  }
  return workspace
    .read(LOG_ENTRY)
    .split('\n')
    .filter((line) => line.length > 0);
}

/** Renders a shell command standing in for a concurrent build of the fixture's one covered package. */
export function rebuildDigest(repo: string, digest: string): string {
  return `echo ${digest} > ${resolveBuildCachePath(path.join(repo, 'packages', 'a'))}`;
}

/**
 * Runs the CLI in-process against the fixture. The check-result-cache variables are stripped from the ambient
 * environment first: This suite may itself be running under `nmr test`, whose snapshot would otherwise be
 * inherited by these invocations and describe a tree that is not the fixture's.
 */
export async function runNmr(
  argString: string,
  cwd: string,
  extraEnv: Record<string, string> = {},
  options: { terminalFd?: number } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const ambientEnv = readAmbientEnv();
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const stdout = buildDestination(new PassThrough(), options.terminalFd);
  const stderr = buildDestination(new PassThrough(), options.terminalFd);
  stdout.on('data', (chunk: Buffer) => {
    stdoutChunks.push(chunk);
  });
  stderr.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk);
  });

  const { exitCode } = await runCli({
    args: argString.split(/\s+/).filter((argument) => argument.length > 0),
    cwd,
    env: { ...ambientEnv, ...extraEnv },
    stdout,
    stderr,
  });

  return {
    stdout: Buffer.concat(stdoutChunks).toString('utf8'),
    stderr: Buffer.concat(stderrChunks).toString('utf8'),
    exitCode,
  };
}

/**
 * Writes a committed pnpm workspace under `repo/` in the workspace tree: one built package, the pnpm files that
 * the install fingerprint reads, and a config mapping the cacheable command to a script that appends one line
 * per run. `bin/` and the run log are beside it, outside the repository.
 */
export function scaffoldRepo(workspace: TempTree, log: string): void {
  workspace.writeAll({
    'repo/.gitignore': 'node_modules/\ndist/\n',
    'repo/node_modules/.modules.yaml': 'hoistPattern:\n  - "types"\n',
    'repo/node_modules/.pnpm/lock.yaml': 'lockfileVersion: "9.0"\n',
    'repo/package.json': JSON.stringify({ name: 'gate-root', private: true }),
    'repo/packages/a/dist/esm/index.js': 'export const value = 1;\n',
    'repo/packages/a/package.json': JSON.stringify({ name: 'a', type: 'module' }),
    'repo/packages/a/src/index.ts': 'export const value = 1;\n',
    'repo/pnpm-workspace.yaml': 'packages:\n  - "packages/*"\n',
    'repo/src/index.ts': 'export const value = 1;\n',
    'repo/tools/': '',
  });
  writeBuildDigest(workspace, 'repo/packages/a', 'digest-from-this-tree');

  writeConfig(workspace, log);

  const repo = workspace.resolve('repo');
  runGit(repo, ['init', '--initial-branch=main']);
  runGit(repo, ['config', 'user.email', 'fixture@example.com']);
  runGit(repo, ['config', 'user.name', 'Fixture']);
  runGit(repo, ['config', 'commit.gpgsign', 'false']);
  runGit(repo, ['add', '--all']);
  runGit(repo, ['commit', '--message', 'initial']);
}

/** Writes the digest that a build of the package at `packageEntry` would have left beside its output. */
export function writeBuildDigest(workspace: TempTree, packageEntry: string, digest: string): void {
  // The cache path folds a digest of the absolute package directory, so it is resolved and then relativized.
  const cachePath = resolveBuildCachePath(workspace.resolve(packageEntry));
  workspace.write(path.relative(workspace.dir, cachePath), digest);
}

/**
 * Writes the fixture's nmr config. Rewriting it after the initial commit changes the tree, which is why each
 * test that needs a different config writes it before its first run rather than between two.
 */
export function writeConfig(
  workspace: TempTree,
  log: string,
  options: {
    checkCache?: Record<string, unknown>;
    command?: ScriptValue;
    devBin?: Record<string, string>;
    extraRootScripts?: Record<string, ScriptValue>;
  } = {},
): void {
  const config = {
    ...(options.checkCache && { checkCache: options.checkCache }),
    ...(options.devBin && { devBin: options.devBin }),
    rootScripts: {
      [COMMAND]: options.command ?? `echo ran >> ${log}`,
      ...options.extraRootScripts,
    },
  };

  workspace.write('repo/.config/nmr.config.ts', `export default ${JSON.stringify(config)};\n`);
}

/**
 * Writes an executable named `nmr` that stands in for the real one, returning the directory to put on `PATH`.
 * A step leading with the `nmr` token has to spawn something that succeeds before a pass can be recorded, and
 * the installed binary is not reliably on the suite's `PATH`.
 */
export function writeNmrShim(workspace: TempTree, log: string, output?: string): string {
  const echoOutput = output === undefined ? '' : `echo '${output}'\n`;
  const shim = workspace.write('bin/nmr', `#!/bin/sh\necho ran >> ${log}\n${echoOutput}`);
  // `node:fs`, because the tree's write does not take a mode and the shim has to be executable.
  fs.chmodSync(shim, 0o755);

  return path.dirname(shim);
}

// region | Helpers

/**
 * Decorates a destination as a terminal on the given descriptor, so the runner hands the child that descriptor
 * and nmr sees none of what flows through it. Left undecorated, the stream does not have a descriptor and is
 * piped.
 */
function buildDestination(stream: PassThrough, terminalFd: number | undefined): PassThrough {
  return terminalFd === undefined ? stream : Object.assign(stream, { fd: terminalFd, isTTY: true });
}

/** Runs git in `cwd`, discarding its output. */
function runGit(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

// endregion | Helpers
