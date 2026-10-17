import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { runCli } from '../runCli.ts';
import { readAmbientEnv } from './readAmbientEnv.ts';

export const MONOREPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
export const NMR_PACKAGE_DIR = path.resolve(MONOREPO_ROOT, 'packages', 'nmr');
export const CLI_PATH = path.join(NMR_PACKAGE_DIR, 'dist', 'esm', 'cli.js');

/** Builds a reader and a clearer for the marker log at the path that `getPath` returns. */
export function makeLogHelpers(getPath: () => string): { read: () => string[]; clear: () => void } {
  return {
    read: () => {
      try {
        return readFileSync(getPath(), 'utf8')
          .split('\n')
          .filter((line) => line.length > 0);
      } catch {
        return [];
      }
    },
    // eslint-disable-next-line no-restricted-syntax -- the marker log is in a directory that the suite manages by hand until #622 converts it.
    clear: () => writeFileSync(getPath(), ''),
  };
}

/**
 * Runs the CLI in-process with PassThrough streams, which spares each test a `node` cold start. A subprocess test is
 * for real-process behavior that the in-process path cannot exercise: signals, env-var inheritance through the bin
 * shim, and kernel exit codes.
 *
 * Hooks still spawn the bin for `nmr X:pre` and `nmr X:post`, which the file-level `beforeAll` warms. To see that
 * inner output live while debugging, swap `stdoutStream`/`stderrStream` for `process.stdout`/`process.stderr`.
 *
 * `argString` is split on whitespace, without shell-style quoting; a test that needs a quoted argument calls
 * `runCli` directly with a pre-built `args` array.
 */
export async function runNmr(
  argString: string,
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const args = argString.length === 0 ? [] : argString.split(/\s+/).filter((s) => s.length > 0);
  const ambientEnv = readAmbientEnv();
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();
  stdoutStream.on('data', (chunk: Buffer) => {
    stdoutChunks.push(chunk);
  });
  stderrStream.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk);
  });

  const { exitCode } = await runCli({
    args,
    cwd: options.cwd ?? MONOREPO_ROOT,
    env: { ...ambientEnv, ...options.env },
    stdout: stdoutStream,
    stderr: stderrStream,
  });

  return {
    stdout: Buffer.concat(stdoutChunks).toString('utf8'),
    stderr: Buffer.concat(stderrChunks).toString('utf8'),
    exitCode,
  };
}

/**
 * Warms the OS page cache for `node` and the nmr dist. A failed warmup is not fatal: The tests still pass against a
 * cold cache, only more slowly.
 */
export function warmBin(): void {
  try {
    execSync(`node ${CLI_PATH} --help`, { env: readAmbientEnv(), stdio: 'ignore', timeout: 10_000 });
  } catch {
    // Swallow warmup failure; tests will report real issues themselves.
  }
}
