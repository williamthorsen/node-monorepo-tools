import { PassThrough } from 'node:stream';

import type { TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { type Mock, vi } from 'vitest';

import type { TreeReader } from '../check-cache/check-cache.ts';
import { type ChainEntry, ENTRY_CHAIN_ENV_VAR } from '../entry-chain.ts';
import type { ReadFilterSelection } from '../helpers/filter-selection.ts';
import { NO_LOCK_ENV_VAR } from '../machine-lock.ts';
import { runCli, type RunCliOptions } from '../runCli.ts';
import type { RunSteps } from '../runner.ts';
import type { Step } from '../steps.ts';

/** Runs `runCli` in-process against fakes of the runner and the filter probe, which a test stubs and reads. */
export interface RunCliHarness {
  /** The fakes, for a test that calls `runCli` with streams of its own. */
  deps: Required<Pick<RunCliOptions, 'readFilterSelection' | 'readTree' | 'runSteps'>>;
  /** Reads the entry chain from the environment passed to the first `runSteps` call. */
  readChainFromCall: () => unknown;
  /** Answers `'single'` by default: The probe spawns pnpm, which a unit test neither has nor needs. */
  readFilterSelection: Mock<ReadFilterSelection>;
  /** Reads the step list passed to the first `runSteps` call. */
  readStepsFromCall: () => readonly Step[] | undefined;
  /** Answers that the tree is not a git repository by default: A unit test does not spawn git. */
  readTree: { [K in keyof TreeReader]: Mock<TreeReader[K]> };
  /** Runs the CLI against `cwd`, discarding both output streams. */
  run: (args: string[], cwd: string, env?: NodeJS.ProcessEnv) => Promise<{ exitCode: number }>;
  /** Runs the CLI against `cwd`, returning what it wrote to stderr. */
  runReadingStderr: (
    args: string[],
    cwd: string,
    env?: NodeJS.ProcessEnv,
  ) => Promise<{ exitCode: number; stderr: string }>;
  /** Runs the CLI against `cwd`, returning what it wrote to stdout. */
  runReadingStdout: (
    args: string[],
    cwd: string,
    env?: NodeJS.ProcessEnv,
  ) => Promise<{ exitCode: number; stdout: string }>;
  /** Resolves `{ exitCode: 0 }` by default. */
  runSteps: Mock<RunSteps>;
}

/** Builds an environment that carries an inherited entry chain. */
export function composeChainEnv(chain: readonly ChainEntry[]): NodeJS.ProcessEnv {
  return { [ENTRY_CHAIN_ENV_VAR]: JSON.stringify(chain) };
}

/** Builds a harness whose fakes have not been called. */
export function createRunCliHarness(): RunCliHarness {
  const runStepsFake = vi.fn<RunSteps>().mockResolvedValue({ exitCode: 0 });
  const readFilterSelectionFake = vi.fn<ReadFilterSelection>().mockReturnValue('single');
  const readTreeFake = {
    hashWorkingTree: vi
      .fn<TreeReader['hashWorkingTree']>()
      .mockReturnValue({ ok: false, reason: 'not a git repository: fake tree reader' }),
    readHeadSha: vi.fn<TreeReader['readHeadSha']>().mockReturnValue(undefined),
  };
  const deps = { readFilterSelection: readFilterSelectionFake, readTree: readTreeFake, runSteps: runStepsFake };

  return {
    deps,
    readChainFromCall: (): unknown => JSON.parse(runStepsFake.mock.calls[0]?.[2].env?.[ENTRY_CHAIN_ENV_VAR] ?? 'null'),
    readFilterSelection: readFilterSelectionFake,
    readStepsFromCall: () => runStepsFake.mock.calls[0]?.[0],
    readTree: readTreeFake,
    run: async (args, cwd, env = {}) => {
      const { exitCode } = await runCapturing({ args, cwd, deps, env });
      return { exitCode };
    },
    runReadingStderr: async (args, cwd, env = {}) => {
      const { exitCode, stderr } = await runCapturing({ args, cwd, deps, env });
      return { exitCode, stderr };
    },
    runReadingStdout: async (args, cwd, env = {}) => {
      const { exitCode, stdout } = await runCapturing({ args, cwd, deps, env });
      return { exitCode, stdout };
    },
    runSteps: runStepsFake,
  };
}

/** Adds the machine-lock bypass, so that a heavy command neither waits on the suite's own run nor writes the real lock. */
export function withLockBypass(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { [NO_LOCK_ENV_VAR]: '1', ...env };
}

/** Writes a monorepo-root config, which is the only tier that accepts the script registries. */
export function writeConfig(tree: TempTree, config: Record<string, unknown>): void {
  tree.write('.config/nmr.config.ts', `export default ${JSON.stringify(config)};\n`);
}

/** Writes the tier-3 scripts of the monorepo root's own `package.json`. */
export function writePackageScripts(tree: TempTree, scripts: Record<string, string>): void {
  tree.writeJson('package.json', { scripts });
}

// region | Helpers

/** Collects everything written to a stream, read back as UTF-8. */
function collectText(stream: PassThrough): () => string {
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });
  return () => Buffer.concat(chunks).toString('utf8');
}

/** Runs the CLI in-process with the lock bypass, collecting what it wrote to each stream. */
async function runCapturing(options: {
  args: string[];
  cwd: string;
  deps: RunCliHarness['deps'];
  env: NodeJS.ProcessEnv;
}): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const { args, cwd, deps, env } = options;
  const stderr = new PassThrough();
  const stdout = new PassThrough();
  const readStderr = collectText(stderr);
  const readStdout = collectText(stdout);

  const { exitCode } = await runCli({ args, cwd, env: withLockBypass(env), ...deps, stderr, stdout });

  return { exitCode, stderr: readStderr(), stdout: readStdout() };
}

// endregion | Helpers
