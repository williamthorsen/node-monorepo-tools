import { PassThrough } from 'node:stream';

import type { TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { vi } from 'vitest';

import { type ChainEntry, ENTRY_CHAIN_ENV_VAR } from '../entry-chain.ts';
import { NO_LOCK_ENV_VAR } from '../machine-lock.ts';
import { runCli } from '../runCli.ts';
import { runSteps } from '../runner.ts';
import type { Step } from '../steps.ts';

/** Builds an environment that carries an inherited entry chain. */
export function composeChainEnv(chain: readonly ChainEntry[]): NodeJS.ProcessEnv {
  return { [ENTRY_CHAIN_ENV_VAR]: JSON.stringify(chain) };
}

/** Reads the entry chain from the environment passed to the runner, which the calling suite has mocked. */
export function readChainFromCall(): unknown {
  return JSON.parse(vi.mocked(runSteps).mock.calls[0]?.[2].env?.[ENTRY_CHAIN_ENV_VAR] ?? 'null');
}

/** Reads the step list passed to the runner, which the calling suite has mocked. */
export function readStepsFromCall(): readonly Step[] | undefined {
  return vi.mocked(runSteps).mock.calls[0]?.[0];
}

/** Runs the CLI in-process against `cwd`, discarding both output streams. */
export async function runNmr(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<{ exitCode: number }> {
  return runCli({ args, cwd, env: withLockBypass(env), stderr: new PassThrough(), stdout: new PassThrough() });
}

/** Runs the CLI in-process against `cwd`, returning what it wrote to stderr. */
export async function runNmrReadingStderr(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): Promise<{ exitCode: number; stderr: string }> {
  const chunks: Buffer[] = [];
  const stderr = new PassThrough();
  stderr.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });

  const { exitCode } = await runCli({ args, cwd, env: withLockBypass(env), stderr, stdout: new PassThrough() });

  return { exitCode, stderr: Buffer.concat(chunks).toString('utf8') };
}

/** Runs the CLI in-process against `cwd`, returning what it wrote to stdout. */
export async function runNmrReadingStdout(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): Promise<{ exitCode: number; stdout: string }> {
  const chunks: Buffer[] = [];
  const stdout = new PassThrough();
  stdout.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });

  const { exitCode } = await runCli({ args, cwd, env: withLockBypass(env), stderr: new PassThrough(), stdout });

  return { exitCode, stdout: Buffer.concat(chunks).toString('utf8') };
}

/** Adds the machine-lock bypass, so that a heavy command neither waits on the suite's own run nor writes the real lock. */
export function withLockBypass(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { [NO_LOCK_ENV_VAR]: '1', ...env };
}

/** Writes a monorepo-root config, which is the only tier that accepts `devBin` and the script registries. */
export function writeConfig(tree: TempTree, config: Record<string, unknown>): void {
  tree.write('.config/nmr.config.ts', `export default ${JSON.stringify(config)};\n`);
}

/** Writes the tier-3 scripts of the monorepo root's own `package.json`. */
export function writePackageScripts(tree: TempTree, scripts: Record<string, string>): void {
  tree.writeJson('package.json', { scripts });
}
